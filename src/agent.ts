import Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";
import * as readline from "readline";
import { randomUUID } from "crypto";
import type { PermissionMode, ToolRegistry } from "./tools/index.js";
import { checkPermission } from "./tools/permission.js";
import { buildSystemPrompt } from "./prompt.js";
import {printAssistantText, printConfirmation, printDivider, printInfo, printRetry, printToolCall, printToolResult, startSpinner, stopSpinner} from "./ui.js";
import { saveSession } from "./session.js";

const SNIPPABLE_TOOLS = new Set(["read_file", "grep_search", "list_files", "run_shell"]);
const SNIP_PLACEHOLDER = "[Content snipped - re-read if needed]";
const SNIP_THRESHOLD = 0.60;
const KEEP_RECENT_RESULTS = 3;
const MICROCOMPACT_IDLE_MS = 5 * 60 * 1000; // 5 minutes

interface AgentOptions {
    baseURL: string;
    apiKey: string;
    model: string;
    thinking: boolean;
    toolRegistry: ToolRegistry;
    permissionMode?: PermissionMode;
}


export class AgentLoop {
    private anthropicClient: Anthropic;
    private abortController: AbortController | null = null;
    private toolRegistry: ToolRegistry;
    private thinking: boolean;
    private model: string = "deepseek-v4-flash";
    private messages: Anthropic.MessageParam[] = [];
    private effectiveWindow: number = 200000; // 留出一些余量，避免接近模型上下文限制时出错.
    private sessionId: string;
    private isSubAgent: boolean = false;
    private totalInputTokens: number = 0;
    private totalOutputTokens: number = 0;
    private lastInputTokenCount: number = 0;
    private sessionStartTime: string;
    private confirmedPaths: Set<string> = new Set();

    // Multi-tier compression state
    private lastApiCallTime = 0;
    // Sub-agent output buffer (captures text instead of printing)
    private outputBuffer: string[] | null = null;
    private permissionMode: PermissionMode = "default";

    // private confirmedPaths: Set<string> = new Set();

    constructor(options: AgentOptions) {
        this.sessionStartTime = new Date().toISOString();
        this.sessionId = randomUUID().slice(0, 8);
        this.anthropicClient = new Anthropic({
            baseURL : options.baseURL,
            apiKey: options.apiKey
        });
        this.thinking = options.thinking;
        this.toolRegistry = options.toolRegistry;
        this.model = options.model;
        if (options.permissionMode) this.permissionMode = options.permissionMode;
    }

    
    
    async chat(userMessage: string): Promise<void> {
        this.messages.push({ role: "user", content: userMessage });
        await this.checkAndCompact();

        while (true) {
            if (this.abortController?.signal.aborted) break;
            this.runCompressionPipeline();



            if (!this.isSubAgent) startSpinner();
            const response = await this.callAnthropicStream();
            if (!this.isSubAgent) stopSpinner();
            // 累计 token 用量

            this.totalInputTokens += response.usage.input_tokens;
            this.totalOutputTokens += response.usage.output_tokens;
            this.lastInputTokenCount = response.usage.input_tokens;

            this.lastApiCallTime = Date.now();
             // assistant 响应推入历史
            this.messages.push({ role: "assistant", content: response.content });

            // 提取 tool_use block
            const toolUses: Anthropic.ToolUseBlock[] = [];
            for (const block of response.content) {
                if (block.type === "tool_use") toolUses.push(block);
            }

            // 没有工具调用 → 任务完成
            if (toolUses.length === 0) {
                break;
            }

            // 串行执行每个工具
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const toolUse of toolUses) {
                if (this.abortController?.signal.aborted) break;

                const input = toolUse.input as Record<string, any>;
                printToolCall(toolUse.name, input);

                // 权限检查
                const perm = checkPermission(toolUse.name, input, this.permissionMode);
                if (perm.action === "deny") {
                    toolResults.push({ type: "tool_result", tool_use_id: toolUse.id,
                    content: `Action denied: ${perm.message}` });
                    continue;
                }
                if (perm.action === "confirm" && perm.message && !this.confirmedPaths.has(perm.message)) {
                    const confirmed = await this.confirmDangerous(perm.message);
                    if (!confirmed) {
                    toolResults.push({ type: "tool_result", tool_use_id: toolUse.id,
                        content: "User denied this action." });
                    continue;
                    }
                    this.confirmedPaths.add(perm.message);
                }

                const result = await this.toolRegistry.execute(toolUse.name, input);
                printToolResult(toolUse.name, result);
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
            }

            // 工具结果以 user 消息推入（Anthropic API 要求）
            this.messages.push({ role: "user", content: toolResults });
            if (!this.isSubAgent) {
                printDivider();
                this.autoSave();
            }
        }
    }


    
    private async callAnthropicStream(
        
    ): Promise<Anthropic.Message> {
        return withRetry(async (signal) => {
            const maxOutput = 16384
            const createParams: any = {
                model: this.model,
                max_tokens: maxOutput ,
                system: buildSystemPrompt(),
                tools: this.toolRegistry.getSchemas(),
                messages: this.messages,
            };
            if (this.thinking) {
                createParams.thinking = { type: "enabled", budget_tokens: maxOutput - 1 }
            }

            const stream = this.anthropicClient!.messages.stream(createParams, { signal });

            // Stream text content (SDK high-level event)
            let firstText = true;
            stream.on("text", (text: string) => {
                if (firstText) { stopSpinner(); this.emitText("\n"); firstText = false; }
                this.emitText(text);
            });
            let inThinking = false;
            stream.on("streamEvent" as any, (event: any) => {
                // Thinking passthrough
                if (event.type === "content_block_start" && event.content_block?.type === "thinking") {
                    if (this.thinking) {
                        inThinking = true;
                        stopSpinner();
                       this.emitText("\n" + chalk.dim("  [thinking] "));
                    }
                } else if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta" && inThinking) {
                    this.emitText(chalk.dim(event.delta.thinking));
                }

                if (event.type === "content_block_stop") {
                    if (inThinking) { this.emitText("\n"); inThinking = false; }
                }

            });

            const finalMessage = await stream.finalMessage();
            return finalMessage;
        }, this.abortController?.signal);
    }

    private autoSave() {
        try {
            saveSession(this.sessionId, {
            metadata: { id: this.sessionId, model: this.model, cwd: process.cwd(),
                        startTime: this.sessionStartTime, messageCount: this.messages.length },
            messages: this.messages,

            });
        } catch {}
    }

    restoreSession(data: { messages: any[] }) {
        if (data.messages) this.messages = data.messages;
        printInfo(`Session restored (${this.messages.length} messages).`);
    }
    
    // 控制台中断当前操作
    abort() {
        this.abortController?.abort();
    }
    
    // 当前是否正在处理任务
    get isProcessing(): boolean {
        return this.abortController !== null;
    }

    clearHistory() {
        this.messages = [];
        this.totalInputTokens = 0;
        this.totalOutputTokens = 0;
        this.lastInputTokenCount = 0;
        printInfo("Conversation cleared.");
    }




    // 打印助手文本输出
    private emitText(text: string): void {
    if (this.outputBuffer) {
      this.outputBuffer.push(text);
    } else {
      printAssistantText(text);
    }
  }


    // 用于运行时切换 API 配置
    reconfigure(baseURL: string, apiKey: string, model: string): void {
        this.model = model;
        this.anthropicClient = new Anthropic({ baseURL, apiKey });
    }
    // 新增 getModel() 方法
    getModel(): string { return this.model; }

    setPermissionMode(mode: PermissionMode): void {
        this.permissionMode = mode;
    }

    getPermissionMode(): PermissionMode {
        return this.permissionMode;
    }

    private async confirmDangerous(command: string): Promise<boolean> {
        printConfirmation(command);

        // Fallback for one-shot / non-REPL usage: create a temporary readline
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

    // 上下文管理
    private runCompressionPipeline(): void {
        this.budgetToolResultsAnthropic();
        this.snipStaleResultsAnthropic();
        this.microcompactAnthropic();
    }

    // Step 1: 根据当前上下文和输入的 token 用量，决定是否需要压缩工具结果。
    private budgetToolResultsAnthropic(): void {
        const utilization = this.lastInputTokenCount / this.effectiveWindow;
        if (utilization < 0.5) return;
        const budget = utilization > 0.7 ? 15000 : 30000;
        for (const msg of this.messages) {
            if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
            for (let i = 0; i < msg.content.length; i++) {
                const block = msg.content[i] as any;
                if (block.type === "tool_result" && typeof block.content === "string" && block.content.length > budget) {
                    const keepEach = Math.floor((budget - 80) / 2);
                    block.content = block.content.slice(0, keepEach) +
                        `\n\n[... budgeted: ${block.content.length - keepEach * 2} chars truncated ...]\n\n` +
                    block.content.slice(-keepEach);
                }
            }
        }
    }
    // Step 2: 	在上下文紧张时有选择地剪裁过时/重复内容（保留有用信息）
    // 仅限特定工具：read_file, grep_search, list_files, run_shell
    // 1. 去重：同一文件多次 read_file → 只保留最新一次
    // 2. 保底：始终保留最近 3 条 tool_result（所有可剪裁结果中）
    // 3. （注释提及但未实现“同类搜索 >3 删除最旧”）
    // 占位符"[Content snipped - re-read if needed]"
    private snipStaleResultsAnthropic(): void {

        const utilization = this.lastInputTokenCount / this.effectiveWindow;
        if (utilization < SNIP_THRESHOLD) return;

    // Collect all tool_result blocks with metadata
        const results: { msgIdx: number; blockIdx: number; toolName: string; filePath?: string }[] = [];
        for (let mi = 0; mi < this.messages.length; mi++) {
            const msg = this.messages[mi];
            if (msg?.role !== "user" || !Array.isArray(msg.content)) continue;
            for (let bi = 0; bi < msg.content.length; bi++) {
                const block = msg.content[bi] as any;
                 if (block.type === "tool_result" && typeof block.content === "string" && block.content !== SNIP_PLACEHOLDER) {

          // Find the corresponding tool_use to get tool name and input
                    const toolUseId = block.tool_use_id;
                    const toolInfo = this.findToolUseById(toolUseId);
                    if (toolInfo && SNIPPABLE_TOOLS.has(toolInfo.name)) {
                        results.push({ msgIdx: mi, blockIdx: bi, toolName: toolInfo.name, filePath: toolInfo.input?.file_path });
                    }
                }
            }
        }

        if (results.length <= KEEP_RECENT_RESULTS) return;

        // Strategy: snip duplicates and old results, keep recent N
        const toSnip = new Set<number>();
        const seenFiles = new Map<string, number[]>(); // filePath → indices

        for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        if (r.toolName === "read_file" && r.filePath) {
            const existing = seenFiles.get(r.filePath) || [];
            existing.push(i);
            seenFiles.set(r.filePath, existing);
        }
        }

        // Snip earlier reads of same file
        for (const indices of seenFiles.values()) {
            if (indices.length > 1) {
                for (let j = 0; j < indices.length - 1; j++) toSnip.add(indices[j]!);
            }
        }

    // Snip oldest results beyond keep-recent threshold
        const snipBefore = results.length - KEEP_RECENT_RESULTS;
        for (let i = 0; i < snipBefore; i++) toSnip.add(i);

        for (const idx of toSnip) {
            const r = results[idx];
            const block = (this.messages?.[r.msgIdx]?.content as any[])?.[r.blockIdx];
            block.content = SNIP_PLACEHOLDER;
        }
    }
    // Step 3: 在空闲时激进清理所有老旧结果（最大化释放 token）
    // 所有 tool_result 块（不限工具）
    // 简单 FIFO：保留最近 KEEP_RECENT_RESULTS（3条）条结果，其余全部清除（无去重、无工具类型区分）
    // 占位符
    private microcompactAnthropic(): void {

        if (!this.lastApiCallTime || (Date.now() - this.lastApiCallTime) < MICROCOMPACT_IDLE_MS) return;

        // Collect ALL tool_results across messages, clear all but recent N
        const allResults: { msgIdx: number; blockIdx: number }[] = [];
        for (let mi = 0; mi < this.messages.length; mi++) {
            const msg = this.messages[mi];
            if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
        for (let bi = 0; bi < msg.content.length; bi++) {
            const block = msg.content[bi] as any;
            if (block.type === "tool_result" && typeof block.content === "string" &&
                block.content !== SNIP_PLACEHOLDER && block.content !== "[Old result cleared]") {
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

    // Step 4: 全量摘要压缩
    private async checkAndCompact(): Promise<void> {
    if (this.lastInputTokenCount > this.effectiveWindow * 0.85) {
        printInfo("Context window filling up, compacting conversation...");
        await this.compactConversation();
    }
    }
    async compactConversation(): Promise<void> {
    // Invariant: caller must ensure the last message is a plain user-text
    // message (not a tool_result). We slice it off below; if it were a
    // tool_result, the preceding assistant's tool_use would be orphaned and
    // the API would reject the summarize call.
    if (this.messages.length < 4) return;
        const lastUserMsg = this.messages[this.messages.length - 1];
        const summaryReq: Anthropic.MessageParam[] = [
        {
            role: "user",
            content: "Summarize the conversation so far in a concise paragraph, preserving key decisions, file paths, and context needed to continue the work.",
        },
        ];
        const summaryResp = await this.anthropicClient!.messages.create({
            model: this.model,
            max_tokens: 2048,
            system: "You are a conversation summarizer. Be concise but preserve important details.",
            messages: [
                ...this.messages.slice(0, -1),
                ...summaryReq,
            ],
        });
        const summaryText =
        summaryResp.content[0]?.type === "text"
            ? summaryResp.content[0].text
            : "No summary available.";
        this.messages = [
            { role: "user", content: `[Previous conversation summary]\n${summaryText}` },
            { role: "assistant", content: "Understood. I have the context from our previous conversation. How can I continue helping"},
        ];
        if (lastUserMsg && lastUserMsg.role === "user") this.messages.push(lastUserMsg);
        this.lastInputTokenCount = 0;
    }

    // 辅助函数
    // 根据 tool_use_id 查找工具调用信息（工具名、输入参数）
    private findToolUseById(toolUseId: string): { name: string; input: any } | null {
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



async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 3
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
