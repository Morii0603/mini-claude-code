import { BaseTool } from "../types.js";

export class ToolSearchTool extends BaseTool {
  name = "tool_search";
  description =
    "Search for available tools by name or keyword. Returns full schema definitions for matching deferred tools so you can use them.";
  input_schema = {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Tool name or search keywords",
      },
    },
    required: ["query"],
  };



  async run(): Promise<string> {
    return "pass";
  }
}
