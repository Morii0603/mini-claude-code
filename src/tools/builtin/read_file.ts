import { readFile } from "node:fs/promises";
import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";

export class ReadFileTool extends BaseTool {
  def: ToolDef = {
    name: "read_file",
    description:
      "Read the contents of a file. Returns the file content with line numbers.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to read",
        },
      },
      required: ["file_path"],
    },
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const filePath = input.file_path as string;
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      return lines
        .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
        .join("\n");
    } catch (err: any) {
      return `Error reading file: ${err.message}`;
    }
  }
}
