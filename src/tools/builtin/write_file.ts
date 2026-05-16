import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";

/**
 * If a .md file (not MEMORY.md) was written to the memory directory,
 * rebuild the MEMORY.md index in that directory.
 */
async function autoUpdateMemoryIndex(filePath: string): Promise<void> {
  try {
    if (!filePath.endsWith(".md") || basename(filePath) === "MEMORY.md") return;

    // Find the memory dir: walk up from filePath looking for MEMORY.md
    let dir = dirname(filePath);
    const memIndexPath = join(dir, "MEMORY.md");

    // Check if a MEMORY.md already exists in this or a parent dir
    let memDir: string | undefined;
    let current = dirname(filePath);
    while (current) {
      try {
        await readFile(join(current, "MEMORY.md"), "utf-8");
        memDir = current;
        break;
      } catch {
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
    if (!memDir) return;

    const entries = await readdir(memDir, { withFileTypes: true });
    const lines: string[] = ["# Memory Index", ""];

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "MEMORY.md") continue;

      try {
        const raw = await readFile(join(memDir, entry.name), "utf-8");
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const typeMatch = raw.match(/^type:\s*(.+)$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        if (nameMatch && typeMatch) {
          const n = nameMatch[1]!.trim();
          const t = typeMatch[1]!.trim();
          const d = descMatch ? descMatch[1]!.trim() : "";
          lines.push(`- [${n}](${entry.name}) — ${d}`);
        }
      } catch {
        // skip unreadable files
      }
    }

    await writeFile(join(memDir, "MEMORY.md"), lines.join("\n"), "utf-8");
  } catch {
    // silently fail — memory index update is non-critical
  }
}

export class WriteFileTool extends BaseTool {
  def: ToolDef = {
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["file_path", "content"],
    },
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const filePath = input.file_path as string;
    const content = input.content as string;

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf-8");

      // Non-critical: try to update memory index
      autoUpdateMemoryIndex(filePath).catch(() => {});

      const lines = content.split("\n");
      const preview = lines
        .slice(0, 30)
        .map((l, i) => `${String(i + 1).padStart(4)} | ${l}`)
        .join("\n");

      const trunc = lines.length > 30 ? `\n  ... (${lines.length} lines total)` : "";
      return `Successfully wrote to ${filePath} (${lines.length} lines)\n\n${preview}${trunc}`;
    } catch (err: any) {
      return `Error writing file: ${err.message}`;
    }
  }
}
