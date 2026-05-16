import { BaseTool } from "../tools/types.js";
import type { ToolDef } from "../tools/types.js";

export class McpTool extends BaseTool {
  def: ToolDef;
  private runner: (input: Record<string, unknown>) => Promise<string>;

  constructor(
    def: ToolDef,
    runner: (input: Record<string, unknown>) => Promise<string>,
  ) {
    super();
    this.def = def;
    this.runner = runner;
  }

  async run(input: Record<string, unknown>): Promise<string> {
    return this.runner(input);
  }
}
