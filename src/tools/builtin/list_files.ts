import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { BaseTool } from "../types.js";
import type { InputSchema } from "../types.js";

/** Minimal glob-to-regex converter for basic patterns. */
function globToRegex(pattern: string): RegExp {
  // Escape regex special chars except * and ?
  let src = "";
  for (const ch of pattern) {
    if (ch === "*") {
      src += ".*";
    } else if (ch === "?") {
      src += ".";
    } else if ("+^${}()|[\\]".includes(ch)) {
      src += "\\" + ch;
    } else {
      src += ch;
    }
  }
  return new RegExp(`^${src}$`);
}

/** Recursively walk directory collecting file paths. Returns up to `limit` files. */
function walkDir(
  dir: string,
  baseDir: string,
  limit: number,
): string[] {
  const results: string[] = [];
  function walk(current: string) {
    if (results.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git" || name.startsWith(".")) continue;
      const full = join(current, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const rel = relative(baseDir, full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        results.push(rel.split(sep).join("/"));
        if (results.length >= limit) return;
      }
    }
  }
  walk(dir);
  return results;
}

export class ListFilesTool extends BaseTool {
  name = "list_files";
  description =
    "List files matching a glob pattern. Returns matching file paths.";
  input_schema: InputSchema = {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          'Glob pattern to match files (e.g., "**/*.ts", "src/**/*")',
      },
      path: {
        type: "string",
        description:
          "Base directory to search from. Defaults to current directory.",
      },
    },
    required: ["pattern"],
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const pattern = input.pattern as string;
    const basePath = (input.path as string) || process.cwd();
    const limit = 200;

    const allFiles = walkDir(basePath, basePath, limit * 2);

    // Convert glob pattern to regex, handling **
    // Replace ** (which means match everything) temporarily
    const processedPattern = pattern.includes("**")
      ? pattern
      : // If no **, treat * as single-level wildcard
        pattern;

    let regex: RegExp;
    if (pattern.includes("**")) {
      // For ** patterns, just test against the end or full path
      const parts = pattern.split("**");
      const prefix = parts[0] || "";
      const suffix = parts.slice(1).join("**") || "";
      // Match paths that start with prefix and end with suffix
      const prefixRe = prefix ? globToRegex(prefix).source.replace(/^\^/, "") : "";
      const suffixRe = suffix ? globToRegex(suffix).source.replace(/\$$/, "") : "";
      regex = new RegExp(`^${prefixRe}.*${suffixRe}$`);
    } else {
      regex = globToRegex(pattern);
    }

    const matched = allFiles.filter((f) => regex.test(f));
    const files = matched.slice(0, limit);

    if (files.length === 0) return "No files found matching the pattern.";
    const result = files.join("\n");
    if (matched.length > limit) {
      return result + `\n... and ${matched.length - limit} more`;
    }
    return result;
  }
}
