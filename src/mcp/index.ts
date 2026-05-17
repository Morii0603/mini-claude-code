import { loadMcpConfig, saveMcpConfig } from "./config.js";
import { ClientManager } from "./client-manager.js";
import type { McpServerDef } from "./types.js";

export type { McpServerDef, McpConfig } from "./types.js";
export { loadMcpConfig, saveMcpConfig } from "./config.js";
export { ClientManager } from "./client-manager.js";

export async function initMcp(cwd: string): Promise<ClientManager> {
  const config = loadMcpConfig(cwd);
  const manager = new ClientManager();

  const results: Array<{ server: string; ok: boolean; error?: string }> = [];

  for (const server of config.servers) {
    try {
      await manager.connectServer(server);
      results.push({ server: server.name, ok: true });
    } catch (e: any) {
      results.push({ server: server.name, ok: false, error: e.message });
    }
  }

  if (results.length > 0) {
    const connected = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    if (connected.length > 0) {
      console.log(
        `  MCP: ${connected.length} server(s) connected (${connected.map((r) => r.server).join(", ")})`,
      );
    }
    for (const f of failed) {
      console.log(`  MCP: failed to connect to "${f.server}" — ${f.error}`);
    }
  }

  return manager;
}

export async function addMcpServer(
  manager: ClientManager,
  server: McpServerDef,
  cwd: string,
): Promise<void> {
  await manager.connectServer(server);
  saveMcpConfig(server, cwd);
}

export async function removeMcpServer(
  manager: ClientManager,
  serverName: string,
): Promise<void> {
  await manager.disconnectServer(serverName);
}

export function listMcpServers(manager: ClientManager): Array<{
  name: string;
  config: McpServerDef;
  tools: Array<{ name: string; description?: string | undefined }>;
}> {
  return manager.getServerNames().map((name) => ({
    name,
    config: manager.getServerConfig(name)!,
    tools: manager.getTools(name).map((t) => {
      const result: { name: string; description?: string | undefined } = {
        name: t.toolName,
      };
      if (t.description !== undefined) {
        result.description = t.description;
      }
      return result;
    }),
  }));
}
