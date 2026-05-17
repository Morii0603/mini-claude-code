import { BaseTool } from "../types.js";
import type { ToolRegistry } from "../registry.js";

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

  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    super();
    this.registry = registry;
  }

  async run(input: Record<string, unknown>): Promise<string> {
    const query = input.query as string;
    const results = this.registry.searchAndActivate(query);

    if (results.length === 0) {
      const deferred = this.registry.getDeferredSummaries();
      const names = deferred.map((d) => d.name).join(", ") || "(none)";
      return `No deferred tools found matching "${query}". Deferred tools available: ${names}`;
    }

    return (
      `${results.length} tool(s) activated for the next turn:\n\n` +
      results.map((t) => JSON.stringify(t, null, 2)).join("\n---\n")
    );
  }
}
