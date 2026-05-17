import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { homedir } from "os";
import { parseFrontmatter } from "./frontmatter.js";

// ─── constants ────────────────────────────────────────────────────────────

/** Max chars of skill descriptions to include in the system prompt. */
const SKILL_DESC_BUDGET = 4000;

/** Max chars of a single skill description before truncation. */
const SKILL_DESC_MAX = 600;

// ─── types ────────────────────────────────────────────────────────────────

export interface SkillManifest {
  name: string;
  description: string;
  path: string; // full path to SKILL.md
  userInvocable: boolean;
  source: "project" | "user";
}

interface SkillDocument {
  manifest: SkillManifest;
  body: string; // loaded on demand (or empty if not yet loaded)
}

// ─── directory resolution ─────────────────────────────────────────────────

function resolveSkillDirs(): string[] {
  const dirs: string[] = [];
  // User-global loads first (lower priority)
  const userDir = join(homedir(), ".mini-claude", "skills");
  if (existsSync(userDir)) dirs.push(userDir);

  // Project-local loads second (higher priority, overrides user)
  const projectDir = join(process.cwd(), ".mini-claude", "skills");
  if (existsSync(projectDir)) dirs.push(projectDir);

  return dirs;
}

// ─── recursive SKILL.md discovery ─────────────────────────────────────────

function discoverSkillFiles(dir: string): string[] {
  const results: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (entry === "SKILL.md") {
        results.push(full);
      }
    }
  }
  return results.sort();
}

// ─── SkillRegistry ────────────────────────────────────────────────────────

export class SkillRegistry {
  private documents: Map<string, SkillDocument> = new Map();
  private loadedDirs: string[] = [];

  constructor() {
    this.reload();
  }

  /** Re-scan skill directories and reload all manifests. */
  reload(): void {
    this.documents.clear();
    this.loadedDirs = resolveSkillDirs();

    for (const dir of this.loadedDirs) {
      const source: "user" | "project" = dir.includes(join(homedir(), ".mini-claude"))
        ? "user"
        : "project";
      const skillFiles = discoverSkillFiles(dir);
      for (const filePath of skillFiles) {
        let raw: string;
        try {
          raw = readFileSync(filePath, "utf-8");
        } catch {
          continue;
        }
        const parsed = parseFrontmatter(raw);
        if (!parsed) continue;

        const name =
          parsed.meta["name"] ||
          relative(dir, filePath).replace(/[/\\]SKILL\.md$/, "").replace(/[/\\]/g, "-");

        if (!parsed.meta["name"]) continue; // name is required

        const manifest: SkillManifest = {
          name,
          description: parsed.meta["description"] || "No description",
          path: filePath,
          userInvocable: parsed.meta["user-invocable"]?.toLowerCase() === "true",
          source,
        };

        // Later-loaded (project) overwrites earlier (user) on same name
        this.documents.set(name, {
          manifest,
          body: "", // lazy — loaded on demand
        });
      }
    }
  }

  // ── describe (for system prompt) ──────────────────────────────────────

  /** Build a compact skill listing for injection into the system prompt. */
  buildSkillDescriptions(): string {
    if (this.documents.size === 0) return "";

    // Budget check: if we're within budget, describe all
    const fullList = this.describeAll(Number.MAX_SAFE_INTEGER);
    if (fullList.length <= SKILL_DESC_BUDGET) {
      return `\n\n# Available Skills\n\nUse the \`load_skill\` tool to load a skill's full instructions into context before using it. User-invocable skills marked with \`/\` can also be invoked directly by the user.\n\n${fullList}`;
    }

    // Over budget: compress to names only
    const names = [...this.documents.keys()].sort();
    const compressed = names.map((n) => {
      const m = this.documents.get(n)!.manifest;
      const tag = m.userInvocable ? `/${n}` : n;
      return `- ${tag}: ${m.description.slice(0, 100)}`;
    }).join("\n");

    return `\n\n# Available Skills\n\nUse \`load_skill\` to load a skill. Use \`/skill_name\` to invoke user skills directly.\n\n${compressed}`;
  }

  /** List descriptions suitable for /skills CLI. */
  describeAll(maxChars?: number): string {
    const limit = maxChars ?? SKILL_DESC_BUDGET;
    const lines: string[] = [];
    let total = 0;

    for (const name of [...this.documents.keys()].sort()) {
      const m = this.documents.get(name)!.manifest;
      const tag = m.userInvocable ? `/${name}` : name;
      const desc = m.description.length > SKILL_DESC_MAX
        ? m.description.slice(0, SKILL_DESC_MAX) + "..."
        : m.description;
      const line = `- ${tag} (${m.source}) — ${desc}`;
      if (total + line.length > limit) {
        lines.push(`... (${this.documents.size - lines.length} more skills, use /skills to list all)`);
        break;
      }
      lines.push(line);
      total += line.length;
    }
    return lines.join("\n");
  }

  // ── load ──────────────────────────────────────────────────────────────

  /** Load the full body of a skill by name. Returns null if not found. */
  loadSkill(name: string): SkillDocument | null {
    const doc = this.documents.get(name);
    if (!doc) return null;

    // Lazy load body from disk if not yet loaded
    if (!doc.body) {
      try {
        const raw = readFileSync(doc.manifest.path, "utf-8");
        const parsed = parseFrontmatter(raw);
        doc.body = parsed?.body || raw;
      } catch {
        return null;
      }
    }
    return doc;
  }

  /**
   * Load and format a skill's full text for injection into context.
   * Returns an error string if the skill is not found.
   */
  loadFullText(name: string): string {
    const doc = this.loadSkill(name);
    if (!doc) {
      const known = [...this.documents.keys()].sort().join(", ") || "(none)";
      return `Error: Unknown skill '${name}'. Available skills: ${known}`;
    }
    return (
      `<skill name="${doc.manifest.name}">\n` +
      `${doc.body}\n` +
      `</skill>`
    );
  }

  // ── query ─────────────────────────────────────────────────────────────

  getSkillByName(name: string): SkillDocument | null {
    return this.loadSkill(name);
  }

  listAll(): SkillManifest[] {
    return [...this.documents.values()]
      .map((d) => d.manifest)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get count(): number {
    return this.documents.size;
  }
}

// ─── singleton ────────────────────────────────────────────────────────────

let _instance: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!_instance) {
    _instance = new SkillRegistry();
  }
  return _instance;
}

/** Convenience for prompt.ts */
export function buildSkillDescriptions(): string {
  return getSkillRegistry().buildSkillDescriptions();
}
