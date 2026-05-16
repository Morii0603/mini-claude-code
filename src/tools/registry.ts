import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type Anthropic from "@anthropic-ai/sdk";
import type { BaseTool, ToolDef } from "./types.js";

const TOOL_OUTPUT_DIR = join(homedir(), ".mini-claude", "tool_outputs");

function ensureToolOutputDir() {
  if (!existsSync(TOOL_OUTPUT_DIR)) mkdirSync(TOOL_OUTPUT_DIR, { recursive: true });
}

export class ToolRegistry {
  private tools = new Map<string, BaseTool>();

  /** Maximum characters per tool result before truncation. 0 = no limit. */
  maxResultLength = 10_000;

  register(tool: BaseTool): void {
    if (this.tools.has(tool.def.name)) {
      throw new Error(`Tool already registered: ${tool.def.name}`);
    }
    this.tools.set(tool.def.name, tool);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    const result = await tool.run(input);
    return this.truncate(result, name);
  }

  /**
   * Truncate long results keeping both head and tail, since important
   * output (compile errors, test summaries) often appears at the end.
   * The truncation hint tells the LLM how to retrieve the full content.
   */
  private truncate(result: string, toolName: string): string {
    const limit = this.maxResultLength;
    if (limit <= 0 || result.length <= limit) return result;

    // Write full output to a temp file so the LLM can read it
    ensureToolOutputDir();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${toolName}_${ts}.output`;
    const filepath = join(TOOL_OUTPUT_DIR, filename);
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

  // ─── Deferred tool activation ────────────────────────────────────────
  // Tools with def.deferred=true are NOT sent to the API until activated.
  // The model activates them via tool_search — only name+description is shown
  // in the system prompt, saving thousands of input tokens per turn.
  private activatedDeferred = new Set<string>();

  /** Return schemas for the LLM: all non-deferred + activated deferred. */
  getSchemas(): Anthropic.Tool[] {
    const schemas: Anthropic.Tool[] = [];
    for (const tool of this.tools.values()) {
      if (!tool.def.deferred) {
        schemas.push(tool.def);
      } else if (this.activatedDeferred.has(tool.def.name)) {
        schemas.push(tool.def);
      }
      // else: deferred & not activated → suppressed
    }
    return schemas;
  }

  /** Return schema for a single tool by name, including deferred ones. */
  getSchema(name: string): ToolDef | undefined {
    return this.tools.get(name)?.def;
  }

  /** List names of all registered tools (including deferred). */
  list(): string[] {
    return [...this.tools.keys()];
  }

  
  /**
   * Search among deferred tools, activate matches, and return their
   * full schemas so the LLM can use them in the next turn.
   */
  searchAndActivate(query: string): ToolDef[] {
    const q = query.toLowerCase();
    const matches: ToolDef[] = [];
    for (const tool of this.tools.values()) {
      if (!tool.def.deferred) continue;
      if (
        tool.def.name.toLowerCase().includes(q) ||
        tool.def.description?.toLowerCase().includes(q)
      ) {
        this.activatedDeferred.add(tool.def.name);
        matches.push(tool.def);
      }
    }
    return matches;
  }

  /** Name + description of deferred tools not yet activated (for system prompt). */
  getDeferredSummaries(): Array<{ name: string; description: string }> {
    const summaries: Array<{ name: string; description: string }> = [];
    for (const tool of this.tools.values()) {
      if (tool.def.deferred && !this.activatedDeferred.has(tool.def.name)) {
        summaries.push({
          name: tool.def.name,
          description: tool.def.description || "",
        });
      }
    }
    return summaries;
  }
}
