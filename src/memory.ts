import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parseFrontmatter } from "./frontmatter.js";

// ─── constants ────────────────────────────────────────────────────────────

const MAX_INDEX_LINES = 200;
const MAX_INDEX_BYTES = 25_000;

const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  file: string;
}

// ─── directory resolution ─────────────────────────────────────────────────

/** Project-local memory dir takes precedence; user-global as fallback. */
function resolveMemoryDir(): string {
  const projectDir = join(process.cwd(), ".mini-claude", "memory");
  if (existsSync(projectDir)) return projectDir;

  // Prefer creating project-local if we're in a project with .mini-claude
  const projectRoot = join(process.cwd(), ".mini-claude");
  if (existsSync(projectRoot)) {
    mkdirSync(projectDir, { recursive: true });
    return projectDir;
  }

  // Fall back to user-global
  const userDir = join(homedir(), ".mini-claude", "memory");
  mkdirSync(userDir, { recursive: true });
  return userDir;
}

// ─── MemoryManager ────────────────────────────────────────────────────────

export class MemoryManager {
  private memoryDir: string;
  private memories: Map<string, MemoryEntry> = new Map();

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? resolveMemoryDir();
    this.loadAll();
  }

  get dir(): string {
    return this.memoryDir;
  }

  // ── load / index ─────────────────────────────────────────────────────

  /** Scan all .md files (except MEMORY.md) and populate the in-memory store. */
  loadAll(): void {
    this.memories.clear();
    if (!existsSync(this.memoryDir)) return;

    let files: string[];
    try {
      files = readdirSync(this.memoryDir);
    } catch {
      return;
    }

    for (const file of files.sort()) {
      if (!file.endsWith(".md") || file === "MEMORY.md") continue;

      const filePath = join(this.memoryDir, file);
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      const parsed = parseFrontmatter(raw);
      if (!parsed) continue;

      const name = parsed.meta["name"] || file.replace(/\.md$/, "");
      const memType = (parsed.meta["type"] || "project") as MemoryType;
      if (!MEMORY_TYPES.includes(memType)) continue;

      this.memories.set(name, {
        name,
        description: parsed.meta["description"] || "",
        type: memType,
        content: parsed.body,
        file,
      });
    }
  }

  /** Return the content of MEMORY.md, truncated to size limits. */
  loadMemoryIndex(): string {
    const indexPath = join(this.memoryDir, "MEMORY.md");
    if (!existsSync(indexPath)) return "";

    let content: string;
    try {
      content = readFileSync(indexPath, "utf-8");
    } catch {
      return "";
    }

    const lines = content.split("\n");
    if (lines.length > MAX_INDEX_LINES) {
      content =
        lines.slice(0, MAX_INDEX_LINES).join("\n") +
        "\n\n[... truncated, too many memory entries ...]";
    }
    if (Buffer.byteLength(content, "utf-8") > MAX_INDEX_BYTES) {
      content =
        content.slice(0, MAX_INDEX_BYTES) +
        "\n\n[... truncated, index too large ...]";
    }
    return content;
  }

  // ── list ─────────────────────────────────────────────────────────────

  listMemories(): MemoryEntry[] {
    return [...this.memories.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── save ─────────────────────────────────────────────────────────────

  /**
   * Save a memory to disk and update the index.
   * Returns a status message suitable for tool output.
   */
  saveMemory(name: string, description: string, memType: string, content: string): string {
    if (!MEMORY_TYPES.includes(memType as MemoryType)) {
      return `Error: type must be one of ${MEMORY_TYPES.join(", ")}`;
    }

    const safeName = name.replace(/[^a-zA-Z0-9一-鿿_-]/g, "_").toLowerCase();
    if (!safeName) return "Error: invalid memory name";

    const type = memType as MemoryType;
    const frontmatter = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      `metadata:`,
      `  type: ${type}`,
      "---",
      "",
      content,
    ].join("\n");

    mkdirSync(this.memoryDir, { recursive: true });

    const fileName = `${safeName}.md`;
    const filePath = join(this.memoryDir, fileName);
    writeFileSync(filePath, frontmatter, "utf-8");

    this.memories.set(name, {
      name,
      description,
      type,
      content,
      file: fileName,
    });

    this.rebuildIndex();
    return `Saved memory '${name}' [${type}] to ${fileName}`;
  }

  /**
   * Delete a memory by name. Returns true if deleted.
   */
  deleteMemory(name: string): boolean {
    const entry = this.memories.get(name);
    if (!entry) return false;

    const filePath = join(this.memoryDir, entry.file);
    try {
      unlinkSync(filePath);
    } catch {
      // file already gone, continue
    }

    this.memories.delete(name);
    this.rebuildIndex();
    return true;
  }

  // ── rebuild index ────────────────────────────────────────────────────

  private rebuildIndex(): void {
    const lines: string[] = ["# Memory Index", ""];
    for (const [, mem] of this.memories) {
      lines.push(`- ${mem.name}: ${mem.description} [${mem.type}]`);
      if (lines.length >= MAX_INDEX_LINES) {
        lines.push(`... (truncated at ${MAX_INDEX_LINES} lines)`);
        break;
      }
    }

    mkdirSync(this.memoryDir, { recursive: true });
    writeFileSync(join(this.memoryDir, "MEMORY.md"), lines.join("\n") + "\n", "utf-8");
  }

  // ── system prompt section ────────────────────────────────────────────

  buildPromptSection(): string {
    const index = this.loadMemoryIndex();

    const header = [
      `# Memory System`,
      ``,
      `You have a persistent, file-based memory system at \`${this.memoryDir}\`.`,
      ``,
      `## Memory Types`,
      `- **user**: User's role, preferences, knowledge level`,
      `- **feedback**: Corrections and guidance from the user`,
      `- **project**: Ongoing work, goals, deadlines, decisions`,
      `- **reference**: Pointers to external resources`,
      ``,
      `## How to Save Memories`,
      `Use the \`save_memory\` tool:`,
      `- \`name\`: short kebab-case slug`,
      `- \`description\`: one-line summary`,
      `- \`type\`: user | feedback | project | reference`,
      `- \`content\`: the memory body (markdown)`,
      ``,
      `## What NOT to Save`,
      `- Code patterns or architecture (read the code instead)`,
      `- Git history (use git log)`,
      `- Anything already in CLAUDE.md`,
      `- Ephemeral task details`,
      ``,
    ].join("\n");

    const footer = index
      ? `## Current Memory Index\n\n${index}`
      : "(No memories saved yet.)";

    return `${header}\n${footer}`;
  }
}




// ─── singleton ────────────────────────────────────────────────────────────

let _instance: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager {
  if (!_instance) {
    _instance = new MemoryManager();
  }
  return _instance;
}

/** For use in prompt.ts — builds the memory section for system prompt injection. */
export function buildMemoryPromptSection(): string {
  return getMemoryManager().buildPromptSection();
}
