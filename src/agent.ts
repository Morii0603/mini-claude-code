import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";
import * as readline from "readline";
import { randomUUID } from "crypto";

import type { BaseTool, PermissionMode } from "./tools/index.js";
import { checkPermission } from "./tools/permission.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  printAssistantText,
  printConfirmation,
  printDivider,
  printInfo,
  printRetry,
  printToolCall,
  printToolResult,
  startSpinner,
  stopSpinner,
} from "./ui.js";
import { saveSession } from "./session.js";
import { AgentTool } from "./tools/builtin/agent_tool.js";
import { ToolSearchTool } from "./tools/builtin/tool_search.js";

const SNIPPABLE_TOOLS = new Set(["read_file", "grep_search", "list_files", "run_shell"]);
const SNIP_PLACEHOLDER = "[Content snipped - re-read if needed]";
const SNIP_THRESHOLD = 0.60;
const KEEP_RECENT_RESULTS = 3;
const MICROCOMPACT_IDLE_MS = 5 * 60 * 1000; // 5 minutes

// ─── BaseAgent ────────────────────────────────────────────────────────────

export interface BaseAgentOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  thinking: boolean;
  tools: BaseTool[];
  permissionMode?: PermissionMode;
}

export abstract class BaseAgent {
  protected anthropicClient: Anthropic;
  protected abortController: AbortController | null = null;
  protected aborted: boolean = false;
  protected tools: BaseTool[] = [];
  protected thinking: boolean;
  protected model: string;
  protected systemPrompt: string = "";
  protected messages: Anthropic.MessageParam[] = [];
  protected effectiveWindow: number = 200000;
  protected sessionId: string;
  protected isSubAgent: boolean = false;
  protected totalInputTokens: number = 0;
  protected totalOutputTokens: number = 0;
  protected lastInputTokenCount: number = 0;
  protected sessionStartTime: string;
  protected confirmedPaths: Set<string> = new Set();
  protected lastApiCallTime = 0;
  protected outputBuffer: string[] | null = null;
  protected permissionMode: PermissionMode = "default";

  private prePlanMode: PermissionMode | null = null;    // 进入前的模式（用于恢复）
  private planFilePath: string | null = null;            // plan 文件路径
  private baseSystemPrompt: string = "";                 // 不含 plan 注入的基础提示词
  private contextCleared: boolean = false;               // 审批时是否清空了上下文
  private planApprovalAbortController: AbortController | null = null;


  // External confirmation callback (avoids creating a second readline on stdin)
  private confirmFn?: (message: string) => Promise<boolean>;

  // Plan approval callback: returns { choice, feedback? }
  private planApprovalFn?: (planContent: string, signal: AbortSignal) => Promise<{
    choice: "clear-and-execute" | "execute" | "manual-execute" | "keep-planning";
    feedback?: string;
  }>;

  /** Maximum characters per tool result before truncation. 0 = no limit. */
  maxResultLength = 10_000;

  /** Deferred tools activated via tool_search. Shared with ToolSearchTool. */
  activatedDeferred = new Set<string>();

  constructor(options: BaseAgentOptions) {
    this.sessionStartTime = new Date().toISOString();
    this.sessionId = randomUUID().slice(0, 8);
    this.anthropicClient = new Anthropic({
      baseURL: options.baseURL,
      apiKey: options.apiKey,
    });
    this.thinking = options.thinking;
    this.tools = options.tools;
    this.tools.push(new ToolSearchTool());
    this.model = options.model;
    if (options.permissionMode) this.permissionMode = options.permissionMode;
    this.systemPrompt = buildSystemPrompt(this.tools, this.activatedDeferred);
    
  }

  // ── hooks for subclasses ──────────────────────────────────────────────

  protected abstract emitText(text: string): void;



  /** Called before each API call in the chat loop (e.g. start spinner). */
  protected onBeforeApiCall(): void {}

  /** Called after each API call in the chat loop (e.g. stop spinner). */
  protected onAfterApiCall(): void {}

  /** Called when the first text chunk arrives (e.g. stop spinner). */
  protected handleFirstText(): void {}

  // ── public API ────────────────────────────────────────────────────────

  async chat(userMessage: string): Promise<void> {
    this.aborted = false;
    this.abortController = new AbortController();
    this.messages.push({ role: "user", content: userMessage });
    await this.checkAndCompact();

    try {
      await this.runAgentLoop();
    } finally {
      this.abortController = null;
    }
  }

  /** Execute a task and return the text result. Primary entry point for sub-agents. */
  abstract run(prompt: string): Promise<string>;

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
    this.planApprovalAbortController?.abort();
  }

  get isProcessing(): boolean {
    return this.abortController !== null;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  /** Replace the entire tools array (e.g. after MCP server changes). */
  setTools(tools: BaseTool[]): void {
    this.tools = tools;
  }

  /** Append a tool to the existing tools array. */
  addTool(tool: BaseTool): void {
    this.tools.push(tool);
  }


  getModel(): string {
    return this.model;
  }

  async compactConversation(): Promise<void> {
    if (this.messages.length < 4) return;
    const lastUserMsg = this.messages[this.messages.length - 1];
    const summaryReq: Anthropic.MessageParam[] = [
      {
        role: "user",
        content:
          "Summarize the conversation so far in a concise paragraph, preserving key decisions, file paths, and context needed to continue the work.",
      },
    ];
    const summaryResp = await this.anthropicClient!.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: "You are a conversation summarizer. Be concise but preserve important details.",
      messages: [...this.messages.slice(0, -1), ...summaryReq],
    });
    const summaryText =
      summaryResp.content[0]?.type === "text"
        ? summaryResp.content[0].text
        : "No summary available.";
    this.messages = [
      { role: "user", content: `[Previous conversation summary]\n${summaryText}` },
      { role: "assistant", content: "Understood. I have the context from our previous conversation. How can I continue helping" },
    ];
    if (lastUserMsg && lastUserMsg.role === "user") this.messages.push(lastUserMsg);
    this.lastInputTokenCount = 0;
  }

  // ── tool helpers ──────────────────────────────────────────────────────



  /** Execute a tool by name and return its result string. */
  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    if (tool.name === "tool_search") {
      try {
        return await this.executeToolSearch(input);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return `Tool "tool_search" failed: ${errMsg}`;
      }
    }
    if (name === "enter_plan_mode" || name === "exit_plan_mode") {
      try {
        return await this.executePlanModeTool(name);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return `Tool "${name}" failed: ${errMsg}`;
      }
    }
    try {
      const result = await tool.run(input);
      return this.truncateResult(result, name);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return `Tool "${name}" failed: ${errMsg}`;
    }
  }

  private executeToolSearch(input: Record<string, unknown>): Promise<string> {
    // Implementation for executing tool search
    const query = (input.query as string || "").toLowerCase();
    const deferred = this.tools.filter(t => t.defer_loading);
    const matches = deferred.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (t.description || "").toLowerCase().includes(query)
      );
    if (matches.length === 0) return Promise.resolve("No matching deferred tools found.");
    for (const m of matches) this.activatedDeferred.add(m.name);
    return Promise.resolve(JSON.stringify(matches.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })), null, 2));
  }

  /**
   * Truncate long results keeping both head and tail, since important
   * output (compile errors, test summaries) often appears at the end.
   * The truncation hint tells the LLM how to retrieve the full content.
   */
  private truncateResult(result: string, toolName: string): string {
    const limit = this.maxResultLength;
    if (limit <= 0 || result.length <= limit) return result;

    const dir = join(homedir(), ".mini-claude", "tool_outputs");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${toolName}_${ts}.output`;
    const filepath = join(dir, filename);
    writeFileSync(filepath, result);

    const reserved = 300;
    const headRatio = 0.55;
    const headLen = Math.floor((limit - reserved) * headRatio);
    const tailLen = limit - reserved - headLen;

    const head = result.slice(0, headLen);
    const tail = result.slice(-tailLen);
    const removed = result.length - headLen - tailLen;

    const banner = [
      "",
      `... [${toolName} output truncated: hidden ${removed.toLocaleString()} of ${result.length.toLocaleString()} characters. Full output saved to ${filepath}] ...`,
      "",
    ].join("\n");

    return `${head}${banner}${tail}`;
  }

  /** Build Anthropic.Tool schemas for the API: non-deferred + activated deferred. */
  getSchemas(): Anthropic.Tool[] {
    const schemas: Anthropic.Tool[] = [];
    for (const tool of this.tools) {
      if (tool.defer_loading && !this.activatedDeferred.has(tool.name)) continue;
      const schema: Anthropic.Tool = {
        name: tool.name,
        input_schema: tool.input_schema,
      };
      if (tool.description) schema.description = tool.description;
      schemas.push(schema);
    }
    return schemas;
  }

  /** Name + description of deferred tools not yet activated (for system prompt). */
  getDeferredSummaries(): Array<{ name: string; description: string }> {
    const summaries: Array<{ name: string; description: string }> = [];
    for (const tool of this.tools) {
      if (tool.defer_loading && !this.activatedDeferred.has(tool.name)) {
        summaries.push({
          name: tool.name,
          description: tool.description || "",
        });
      }
    }
    return summaries;
  }

  /**
   * Search among deferred tools, activate matches, and return their
   * full schemas so the LLM can use them in the next turn.
   */
  searchAndActivate(query: string): Anthropic.Tool[] {
    const q = query.toLowerCase();
    const matches: Anthropic.Tool[] = [];
    for (const tool of this.tools) {
      if (!tool.defer_loading) continue;
      if (
        tool.name.toLowerCase().includes(q) ||
        tool.description?.toLowerCase().includes(q)
      ) {
        this.activatedDeferred.add(tool.name);
        matches.push(tool);
      }
    }
    return matches;
  }

  // ── core chat loop ────────────────────────────────────────────────────

  protected async runAgentLoop(): Promise<void> {
    while (true) {
      if (this.abortController?.signal.aborted) break;
      this.runCompressionPipeline();

      this.onBeforeApiCall();
      const response = await this.callAnthropicStream();
      this.onAfterApiCall();

      this.totalInputTokens += response.usage.input_tokens;
      this.totalOutputTokens += response.usage.output_tokens;
      this.lastInputTokenCount = response.usage.input_tokens;
      this.lastApiCallTime = Date.now();

      this.messages.push({ role: "assistant", content: response.content });

      const toolUses: Anthropic.ToolUseBlock[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") toolUses.push(block);
      }

      if (toolUses.length === 0) break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        if (this.abortController?.signal.aborted) break;

        const input = toolUse.input as Record<string, any>;
        if (!this.isSubAgent) printToolCall(toolUse.name, input);

        const perm = checkPermission(toolUse.name, input, this.permissionMode, this.planFilePath ?? undefined);
        if (perm.action === "deny") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Action denied: ${perm.message}`,
          });
          continue;
        }
        if (perm.action === "confirm" && perm.message && !this.confirmedPaths.has(perm.message)) {
          const confirmed = await this.confirmDangerous(perm.message);
          if (!confirmed) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "User denied this action.",
            });
            continue;
          }
          this.confirmedPaths.add(perm.message);
        }

        let result: string;
        try {
          result = await this.executeTool(toolUse.name, input);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result = `Tool "${toolUse.name}" execution error: ${errMsg}`;
        }
        if (!this.isSubAgent) printToolResult(toolUse.name, result);
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
      }

      this.messages.push({ role: "user", content: toolResults });
    }
  }

  protected async callAnthropicStream(): Promise<Anthropic.Message> {
    return withRetry(async (signal) => {
      const maxOutput = 16384;
      const createParams: any = {
        model: this.model,
        max_tokens: maxOutput,
        system: this.systemPrompt,
        tools: this.getSchemas(),
        messages: this.messages,
      };
      if (this.thinking) {
        createParams.thinking = { type: "enabled", budget_tokens: maxOutput - 1 };
      }

      const stream = this.anthropicClient!.messages.stream(createParams, { signal });

      let firstText = true;
      stream.on("text", (text: string) => {
        if (this.aborted) return;
        if (firstText) {
          this.handleFirstText();
          this.emitText("\n");
          firstText = false;
        }
        this.emitText(text);
      });

      let inThinking = false;
      stream.on("streamEvent" as any, (event: any) => {
        if (this.aborted) return;
        if (event.type === "content_block_start" && event.content_block?.type === "thinking") {
          if (this.thinking) {
            inThinking = true;
            this.handleFirstText();
            this.emitText("\n" + chalk.dim("  [thinking] "));
          }
        } else if (
          event.type === "content_block_delta" &&
          event.delta?.type === "thinking_delta" &&
          inThinking
        ) {
          this.emitText(chalk.dim(event.delta.thinking));
        }
        if (event.type === "content_block_stop") {
          if (inThinking) {
            this.emitText("\n");
            inThinking = false;
          }
        }
      });

      const finalMessage = await stream.finalMessage();
      return finalMessage;
    }, this.abortController?.signal);
  }


  // agent.ts — togglePlanMode()

  togglePlanMode(): string {
  if (this.permissionMode === "plan") {
    // 退出：恢复原模式，清理状态，移除 plan 提示
    this.permissionMode = this.prePlanMode || "default";
    this.prePlanMode = null;
    this.planFilePath = null;
    this.systemPrompt = this.baseSystemPrompt;
    printInfo(`Exited plan mode → ${this.permissionMode} mode`);
    return this.permissionMode;
  } else {
    // 进入：保存当前模式，切换权限，生成 plan 文件，注入提示
    this.prePlanMode = this.permissionMode;
    this.permissionMode = "plan";
    this.planFilePath = this.generatePlanFilePath();
    this.systemPrompt = this.baseSystemPrompt + this.buildPlanModePrompt();

    printInfo(`Entered plan mode. Plan file: ${this.planFilePath}`);
    return "plan";
  }
}
// ─── Plan mode helpers ──────────────────────────────────────

  private generatePlanFilePath(): string {
    const dir = join(process.cwd(), ".mini-claude", "plans");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, `plan-${this.sessionId}.md`);
  }

  private buildPlanModePrompt(): string {
    return `

# Plan Mode Active

Plan mode is active. You MUST NOT make any edits (except the plan file below), run non-readonly tools, or make any changes to the system.

## Plan File: ${this.planFilePath}
Write your plan incrementally to this file using write_file or edit_file. This is the ONLY file you are allowed to edit.

## Workflow
1. **Explore**: Read code to understand the task. Use read_file, list_files, grep_search.
2. **Design**: Design your implementation approach. Use the agent tool with type="plan" if the task is complex.
3. **Write Plan**: Write a structured plan to the plan file including:
   - **Context**: Why this change is needed
   - **Steps**: Implementation steps with critical file paths
   - **Verification**: How to test the changes
4. **Exit**: Call exit_plan_mode when your plan is ready for user review.

IMPORTANT: When your plan is complete, you MUST call exit_plan_mode. Do NOT ask the user to approve — exit_plan_mode handles that.`;
  }


  private async executePlanModeTool(name: string): Promise<string> {
    if (name === "enter_plan_mode") {
      if (this.permissionMode === "plan") {
        return "Already in plan mode.";
      }
      this.prePlanMode = this.permissionMode;
      this.permissionMode = "plan";
      this.planFilePath = this.generatePlanFilePath();
      this.systemPrompt = this.baseSystemPrompt + this.buildPlanModePrompt();

      printInfo("Entered plan mode (read-only). Plan file: " + this.planFilePath);
      return `Entered plan mode. You are now in read-only mode.\n\nYour plan file: ${this.planFilePath}\nWrite your plan to this file. This is the only file you can edit.\n\nWhen your plan is complete, call exit_plan_mode.`;
    }

    if (name === "exit_plan_mode") {
      if (this.permissionMode !== "plan") {
        return "Not in plan mode.";
      }
      // Read plan file content
      let planContent = "(No plan file found)";
      if (this.planFilePath && existsSync(this.planFilePath)) {
        planContent = readFileSync(this.planFilePath, "utf-8");
      }

      // Interactive approval flow
      if (this.planApprovalFn) {
        this.planApprovalAbortController = new AbortController();
        const result = await this.planApprovalFn(planContent, this.planApprovalAbortController.signal);
        this.planApprovalAbortController = null;

        if (result.choice === "keep-planning") {
          // User rejected — stay in plan mode, return feedback to model
          const feedback = result.feedback || "Please revise the plan.";
          return `User rejected the plan and wants to keep planning.\n\nUser feedback: ${feedback}\n\nPlease revise your plan based on this feedback. When done, call exit_plan_mode again.`;
        }

        // User approved — determine the target mode
        let targetMode: PermissionMode;
        if (result.choice === "clear-and-execute") {
          targetMode = "acceptEdits";
        } else if (result.choice === "execute") {
          targetMode = "acceptEdits";
        } else {
          // manual-execute
          targetMode = this.prePlanMode || "default";
        }

        // Exit plan mode
        this.permissionMode = targetMode;
        this.prePlanMode = null;
        const savedPlanPath = this.planFilePath;
        this.planFilePath = null;
        this.systemPrompt = this.baseSystemPrompt;


        // Clear context if requested
        if (result.choice === "clear-and-execute") {
          this.clearHistoryKeepSystem();
          this.contextCleared = true; // Signal the agent loop to inject plan as user message
          printInfo(`Plan approved. Context cleared, executing in ${targetMode} mode.`);
          return `User approved the plan. Context was cleared. Permission mode: ${targetMode}\n\nPlan file: ${savedPlanPath}\n\n## Approved Plan:\n${planContent}\n\nProceed with implementation.`;
        }

        printInfo(`Plan approved. Executing in ${targetMode} mode.`);
        return `User approved the plan. Permission mode: ${targetMode}\n\n## Approved Plan:\n${planContent}\n\nProceed with implementation.`;
      }

      // Fallback: no approval function, just exit directly (e.g. sub-agents)
      this.permissionMode = this.prePlanMode || "default";
      this.prePlanMode = null;
      this.planFilePath = null;
      this.systemPrompt = this.baseSystemPrompt;

      printInfo("Exited plan mode. Restored to " + this.permissionMode + " mode.");
      return `Exited plan mode. Permission mode restored to: ${this.permissionMode}\n\n## Your Plan:\n${planContent}`;
    }

    return `Unknown plan mode tool: ${name}`;
  }

  setPlanApprovalFn(fn: (planContent: string, signal: AbortSignal) => Promise<{
    choice: "clear-and-execute" | "execute" | "manual-execute" | "keep-planning";
    feedback?: string;
  }>) {
    this.planApprovalFn = fn;
  }


  private clearHistoryKeepSystem() {
    this.messages = [];
    this.lastInputTokenCount = 0;
  }
  // ── interactive confirmation ──────────────────────────────────────────

  protected async confirmDangerous(command: string): Promise<boolean> {
    printConfirmation(command);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question("  Allow? (y/n): ", (answer) => {
        rl.close();
        resolve(answer.toLowerCase().startsWith("y"));
      });
    });
  }

  // ── context management ────────────────────────────────────────────────

  protected runCompressionPipeline(): void {
    this.budgetToolResultsAnthropic();
    this.snipStaleResultsAnthropic();
    this.microcompactAnthropic();
  }

  private budgetToolResultsAnthropic(): void {
    const utilization = this.lastInputTokenCount / this.effectiveWindow;
    if (utilization < 0.5) return;
    const budget = utilization > 0.7 ? 15000 : 30000;
    for (const msg of this.messages) {
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (let i = 0; i < msg.content.length; i++) {
        const block = msg.content[i] as any;
        if (
          block.type === "tool_result" &&
          typeof block.content === "string" &&
          block.content.length > budget
        ) {
          const keepEach = Math.floor((budget - 80) / 2);
          block.content =
            block.content.slice(0, keepEach) +
            `\n\n[... budgeted: ${block.content.length - keepEach * 2} chars truncated ...]\n\n` +
            block.content.slice(-keepEach);
        }
      }
    }
  }

  private snipStaleResultsAnthropic(): void {
    const utilization = this.lastInputTokenCount / this.effectiveWindow;
    if (utilization < SNIP_THRESHOLD) return;

    const results: { msgIdx: number; blockIdx: number; toolName: string; filePath?: string }[] = [];
    for (let mi = 0; mi < this.messages.length; mi++) {
      const msg = this.messages[mi];
      if (msg?.role !== "user" || !Array.isArray(msg.content)) continue;
      for (let bi = 0; bi < msg.content.length; bi++) {
        const block = msg.content[bi] as any;
        if (
          block.type === "tool_result" &&
          typeof block.content === "string" &&
          block.content !== SNIP_PLACEHOLDER
        ) {
          const toolUseId = block.tool_use_id;
          const toolInfo = this.findToolUseById(toolUseId);
          if (toolInfo && SNIPPABLE_TOOLS.has(toolInfo.name)) {
            results.push({
              msgIdx: mi,
              blockIdx: bi,
              toolName: toolInfo.name,
              filePath: toolInfo.input?.file_path,
            });
          }
        }
      }
    }

    if (results.length <= KEEP_RECENT_RESULTS) return;

    const toSnip = new Set<number>();
    const seenFiles = new Map<string, number[]>();

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.toolName === "read_file" && r.filePath) {
        const existing = seenFiles.get(r.filePath) || [];
        existing.push(i);
        seenFiles.set(r.filePath, existing);
      }
    }

    for (const indices of seenFiles.values()) {
      if (indices.length > 1) {
        for (let j = 0; j < indices.length - 1; j++) toSnip.add(indices[j]!);
      }
    }

    const snipBefore = results.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < snipBefore; i++) toSnip.add(i);

    for (const idx of toSnip) {
      const r = results[idx];
      const block = (this.messages?.[r.msgIdx]?.content as any[])?.[r.blockIdx];
      block.content = SNIP_PLACEHOLDER;
    }
  }

  private microcompactAnthropic(): void {
    if (!this.lastApiCallTime || Date.now() - this.lastApiCallTime < MICROCOMPACT_IDLE_MS) return;

    const allResults: { msgIdx: number; blockIdx: number }[] = [];
    for (let mi = 0; mi < this.messages.length; mi++) {
      const msg = this.messages[mi];
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (let bi = 0; bi < msg.content.length; bi++) {
        const block = msg.content[bi] as any;
        if (
          block.type === "tool_result" &&
          typeof block.content === "string" &&
          block.content !== SNIP_PLACEHOLDER &&
          block.content !== "[Old result cleared]"
        ) {
          allResults.push({ msgIdx: mi, blockIdx: bi });
        }
      }
    }

    const clearCount = allResults.length - KEEP_RECENT_RESULTS;
    for (let i = 0; i < clearCount && i < allResults.length; i++) {
      const r = allResults[i];
      (this.messages[r.msgIdx].content as any[])[r.blockIdx].content = "[Old result cleared]";
    }
  }

  protected async checkAndCompact(): Promise<void> {
    if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
      printInfo("Context window filling up, compacting conversation...");
      await this.compactConversation();
    }
  }

  protected extractFinalResponse(): string {
    if (this.messages.length === 0) return "No response.";
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg.role !== "assistant" || !Array.isArray(lastMsg.content)) {
      return "No response.";
    }
    const textBlocks = lastMsg.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text);
    return textBlocks.length > 0 ? textBlocks.join("\n") : "No text response.";
  }

  protected findToolUseById(toolUseId: string): { name: string; input: any } | null {
    for (const msg of this.messages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content as any[]) {
        if (block.type === "tool_use" && block.id === toolUseId) {
          return { name: block.name, input: block.input };
        }
      }
    }
    return null;
  }
}

// ─── LLMAgent ─────────────────────────────────────────────────────────────

export interface AgentOptions extends BaseAgentOptions {
  /** Prototype sub-agent used by the agent tool to spawn sub-tasks. */
  subagent?: BaseAgent;
}

export class LLMAgent extends BaseAgent {
  private subagent?: BaseAgent;

  constructor(options: AgentOptions) {
    super(options);
    if (options.subagent !== undefined) {
      this.subagent = options.subagent;
      this.addTool(
        new AgentTool(this.subagent)
      )

    }
  }


  // ── hooks ────────────────────────────────────────────────────────────

  protected emitText(text: string): void {
    if (this.isSubAgent && this.outputBuffer) {
      this.outputBuffer.push(text);
    } else {
      printAssistantText(text);
    }
  }

  protected onBeforeApiCall(): void {
    if (!this.isSubAgent) startSpinner();
  }

  protected onAfterApiCall(): void {
    if (!this.isSubAgent) stopSpinner();
  }

  protected handleFirstText(): void {
    if (!this.isSubAgent) stopSpinner();
  }

  // ── public API ───────────────────────────────────────────────────────

  async chat(userMessage: string): Promise<void> {
    await super.chat(userMessage);
    if (!this.isSubAgent) {
      printDivider();
      this.autoSave();
    }
  }

  async run(prompt: string): Promise<string> {
    const prevSubAgent = this.isSubAgent;
    const prevBuffer = this.outputBuffer;
    this.isSubAgent = true;
    this.outputBuffer = [];

    try {
      await this.chat(prompt);
      return this.extractFinalResponse();
    } finally {
      this.isSubAgent = prevSubAgent;
      this.outputBuffer = prevBuffer;
    }
  }

  clearHistory(): void {
    this.messages = [];
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.lastInputTokenCount = 0;
    printInfo("Conversation cleared.");
  }

  reconfigure(baseURL: string, apiKey: string, model: string): void {
    this.model = model;
    this.anthropicClient = new Anthropic({ baseURL, apiKey });
  }

  restoreSession(data: { messages: any[] }): void {
    if (data.messages) this.messages = data.messages;
    printInfo(`Session restored (${this.messages.length} messages).`);
  }

  private autoSave(): void {
    try {
      saveSession(this.sessionId, {
        metadata: {
          id: this.sessionId,
          model: this.model,
          cwd: process.cwd(),
          startTime: this.sessionStartTime,
          messageCount: this.messages.length,
        },
        messages: this.messages,
      });
    } catch {}
  }
}

// ─── retry helpers ────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(signal);
    } catch (error: any) {
      if (signal?.aborted) throw error;
      if (attempt >= maxRetries || !isRetryable(error)) throw error;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000) + Math.random() * 1000;
      const reason = error?.status ? `HTTP ${error.status}` : error?.code || "network error";
      printRetry(attempt + 1, maxRetries, reason);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function isRetryable(error: any): boolean {
  const status = error?.status || error?.statusCode;
  if ([429, 503, 529].includes(status)) return true;
  if (error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT") return true;
  if (error?.message?.includes("overloaded")) return true;
  return false;
}
