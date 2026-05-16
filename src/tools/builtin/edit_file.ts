import { readFile, writeFile } from "node:fs/promises";
import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";
import { findActualString, generateDiff } from "./edit-utils.js";

export class EditFileTool extends BaseTool {
  def: ToolDef = {
    name: "edit_file",
    description:
      "Edit a file by replacing an exact string match with new content. The old_string must match exactly (including whitespace and indentation).",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "The exact string to find and replace",
        },
        new_string: {
          type: "string",
          description: "The string to replace it with",
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const filePath = input.file_path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;

    try {
      const content = await readFile(filePath, "utf-8");

      const actual = findActualString(content, oldString);
      if (!actual) {
        return `Error: old_string not found in ${filePath}`;
      }

      let count = 0;
      let idx = 0;
      while (true) {
        const pos = content.indexOf(actual, idx);
        if (pos === -1) break;
        count++;
        idx = pos + 1;
      }

      if (count > 1) {
        return `Error: old_string found ${count} times in ${filePath}. Must be unique.`;
      }

      const newContent = content.replace(actual, newString);
      await writeFile(filePath, newContent, "utf-8");

      const diff = generateDiff(content, actual, newString);
      const quoteNote =
        actual !== oldString ? " (matched via quote normalization)" : "";
      return `Successfully edited ${filePath}${quoteNote}\n\n${diff}`;
    } catch (err: any) {
      return `Error editing file: ${err.message}`;
    }
  }
}
