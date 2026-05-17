import { BaseTool } from "../types.js";
import { getTodos, setTodos, type TodoItem } from "./todo_store.js";

export class TodoWriteTool extends BaseTool {
  name = "TodoWrite";
  description =
    "Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user. It also helps the user understand the progress of the task and overall progress of their requests.";

  input_schema = {
    type: "object" as const,
    properties: {
      todos: {
        type: "array",
        description: "The updated todo list",
        items: {
          type: "object",
          properties: {
            content: {
              type: "string",
              minLength: 1,
              description: "The content of the task",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "The status of the task",
            },
            activeForm: {
              type: "string",
              minLength: 1,
              description: "The active form of the task (present continuous tense)",
            },
          },
          required: ["content", "status", "activeForm"],
        },
      },
    },
    required: ["todos"],
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const todos = input.todos as TodoItem[];

    // Validate
    for (const item of todos) {
      if (!item.content || !item.status || !item.activeForm) {
        return `Invalid todo item: each item must have content, status, and activeForm. Got: ${JSON.stringify(item)}`;
      }
      if (!["pending", "in_progress", "completed"].includes(item.status)) {
        return `Invalid status "${item.status}" for todo "${item.content}". Must be one of: pending, in_progress, completed.`;
      }
    }

    setTodos(todos);

    if (todos.length === 0) {
      return "Todo list cleared.";
    }

    const statusCounts = {
      pending: todos.filter((t) => t.status === "pending").length,
      in_progress: todos.filter((t) => t.status === "in_progress").length,
      completed: todos.filter((t) => t.status === "completed").length,
    };

    const lines = ["Todos have been modified successfully. Current todo list:"];
    for (const item of todos) {
      const icon =
        item.status === "completed" ? "✓" :
        item.status === "in_progress" ? "►" :
        "○";
      lines.push(`  ${icon} [${item.status}] ${item.content}`);
    }
    lines.push(
      `Summary: ${statusCounts.pending} pending, ${statusCounts.in_progress} in_progress, ${statusCounts.completed} completed`
    );

    return lines.join("\n");
  }
}
