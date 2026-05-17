import { BaseTool } from "../types.js";
import { getTodos } from "./todo_store.js";

export class TodoReadTool extends BaseTool {
  name = "TodoRead";
  description =
    "Read the current todo list. Use this to review the current progress and understand what tasks remain.";

  input_schema = {
    type: "object" as const,
    properties: {},
    required: [],
  };

  async run(_input: Record<string, unknown>): Promise<string> {
    const todos = getTodos();

    if (todos.length === 0) {
      return "No todos currently in the list.";
    }

    const lines = ["Current todo list:"];
    for (const item of todos) {
      const icon =
        item.status === "completed" ? "✓" :
        item.status === "in_progress" ? "►" :
        "○";
      lines.push(`  ${icon} [${item.status}] ${item.content} (${item.activeForm})`);
    }

    return lines.join("\n");
  }
}
