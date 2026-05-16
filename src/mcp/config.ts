import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { McpConfig, McpServerDef } from "./types.js";

function loadJson(path: string): McpConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function loadMcpConfig(cwd: string): McpConfig {
  const globalPath = join(homedir(), ".mini-claude", "mcp.json");
  const localPath = join(cwd, ".mini-claude", "mcp.json");

  const globalConfig = loadJson(globalPath);
  const localConfig = loadJson(localPath);

  const serverMap = new Map<string, McpServerDef>();

  if (globalConfig) {
    for (const s of globalConfig.servers) {
      serverMap.set(s.name, s);
    }
  }

  if (localConfig) {
    for (const s of localConfig.servers) {
      serverMap.set(s.name, s);
    }
  }

  return { servers: [...serverMap.values()] };
}

export function saveMcpConfig(server: McpServerDef, cwd: string): void {
  const localPath = join(cwd, ".mini-claude", "mcp.json");
  const dir = join(cwd, ".mini-claude");

  let config: McpConfig = { servers: [] };
  if (existsSync(localPath)) {
    try {
      config = JSON.parse(readFileSync(localPath, "utf-8"));
    } catch {
      // ignore
    }
  }

  const idx = config.servers.findIndex((s) => s.name === server.name);
  if (idx >= 0) {
    config.servers[idx] = server;
  } else {
    config.servers.push(server);
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, JSON.stringify(config, null, 2));
}
