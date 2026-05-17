import { BaseTool } from "../tools/types.js";
import type Anthropic from "@anthropic-ai/sdk";

export class McpTool extends BaseTool {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  defer_loading = true;
  private runner: (input: Record<string, unknown>) => Promise<string>;

  constructor(
    name: string,
    description: string,
    inputSchema: Anthropic.Tool.InputSchema,
    runner: (input: Record<string, unknown>) => Promise<string>,
  ) {
    super();
    this.name = name;
    this.description = description;
    this.input_schema = inputSchema;
    this.runner = runner;
  }

  async run(input: Record<string, unknown>): Promise<string> {
    return this.runner(input);
  }
}
