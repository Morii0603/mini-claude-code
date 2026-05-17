import type Anthropic from "@anthropic-ai/sdk";

export type InputSchema = Anthropic.Tool.InputSchema;

/** Tool definition — the schema the LLM sees. */
export type ToolDef = Anthropic.Tool & { defer_loading?: boolean };

export type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions" | "dontAsk";

export abstract class BaseTool implements Anthropic.Tool {
  abstract input_schema: Anthropic.Tool.InputSchema;
  abstract name: string;
  abstract description?: string;
  defer_loading?: boolean;
  abstract run(input: Record<string, unknown>): Promise<string>;
}

