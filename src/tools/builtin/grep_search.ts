import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";

const IS_WIN = process.platform === "win32";

/**
 * Pure-Node fallback using recursive directory walk + regex.
 */
function grepPython(
  pattern: string,
  directory: string,
  include: string | undefined,
): string {
  const regex = new RegExp(pattern);
  const matches: string[] = [];
  const limit = 200;

  function walk(dir: string) {
    if (matches.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (include && !name.endsWith(include.replace("*.", "."))) continue;

      try {
        const text = readFileSync(full, "utf-8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            matches.push(`${full}:${i + 1}:${lines[i]}`);
            if (matches.length >= limit) return;
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  walk(directory);

  if (matches.length === 0) return "No matches found.";
  const output = matches.slice(0, 100).join("\n");
  if (matches.length > 100) {
    return output + `\n... and ${matches.length - 100} more matches`;
  }
  return output;
}

export class GrepSearchTool extends BaseTool {
  def: ToolDef = {
    name: "grep_search",
    description:
      "Search for a pattern in files. Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The regex pattern to search for",
        },
        path: {
          type: "string",
          description:
            "Directory or file to search in. Defaults to current directory.",
        },
        include: {
          type: "string",
          description:
            'File glob pattern to include (e.g., "*.ts", "*.py")',
        },
      },
      required: ["pattern"],
    },
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const pattern = input.pattern as string;
    const dir = (input.path as string) || process.cwd();
    const include = input.include as string | undefined;

    // Try system grep on non-Windows
    if (!IS_WIN) {
      try {
        const args = [
          "grep",
          "--line-number",
          "--color=never",
          "-r",
        ];
        if (include) args.push(`--include=${include}`);
        args.push("--", pattern, dir);

        const result = execSync(args.join(" "), {
          encoding: "utf-8",
          timeout: 10_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const lines = result.split("\n").filter(Boolean);
        if (lines.length === 0) return "No matches found.";
        const output = lines.slice(0, 100).join("\n");
        if (lines.length > 100) {
          return output + `\n... and ${lines.length - 100} more matches`;
        }
        return output;
      } catch (err: any) {
        // grep exit code 1 = no matches
        if (err.status === 1) return "No matches found.";
        // other errors → fall through to Node fallback
      }
    }

    return grepPython(pattern, dir, include);
  }
}
