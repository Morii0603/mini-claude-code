import type Anthropic from "@anthropic-ai/sdk";

export type ToolDef = Anthropic.Tool & { deferred?: boolean };

export abstract class BaseTool {
  abstract def: ToolDef;
  abstract run(input: Record<string, unknown>): Promise<string>;
}
export type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions" | "dontAsk";