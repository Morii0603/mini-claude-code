import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";
import { getMemoryManager } from "../../memory.js";

const saveMemoryDef: ToolDef = {
  name: "save_memory",
  description:
    "Save a persistent memory to the file-based memory system. Memories persist across sessions and help Claude remember user preferences, feedback, project context, and external references.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short kebab-case slug for this memory (e.g. 'prefer-tabs', 'api-conventions')",
      },
      description: {
        type: "string",
        description: "One-line summary used to decide relevance in future conversations",
      },
      type: {
        type: "string",
        enum: ["user", "feedback", "project", "reference"],
        description: "Memory type: user (profile/preferences), feedback (corrections/guidance), project (ongoing work/decisions), reference (external resources)",
      },
      content: {
        type: "string",
        description: "The memory body in markdown. For feedback/project types, include a **Why:** line and **How to apply:** line.",
      },
    },
    required: ["name", "description", "type", "content"],
  },
};

export class SaveMemoryTool extends BaseTool {
  def: ToolDef = saveMemoryDef;

  async run(input: Record<string, unknown>): Promise<string> {
    const name = input.name as string;
    const description = input.description as string;
    const memType = input.type as string;
    const content = input.content as string;

    return getMemoryManager().saveMemory(name, description, memType, content);
  }
}
