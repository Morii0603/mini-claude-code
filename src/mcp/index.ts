import { loadMcpConfig, saveMcpConfig } from "./config.js";
import { ClientManager } from "./client-manager.js";
import { McpTool } from "./mcp-tool.js";
import { ToolRegistry } from "../tools/registry.js";
import type { McpServerDef } from "./types.js";
import type { ToolDef } from "../tools/types.js";

export type { McpServerDef, McpConfig } from "./types.js";
export { loadMcpConfig, saveMcpConfig } from "./config.js";
export { ClientManager } from "./client-manager.js";

export async function initMcp(
  registry: ToolRegistry,
  cwd: string,
): Promise<ClientManager> {
  const config = loadMcpConfig(cwd);
  const manager = new ClientManager();

  const results: Array<{ server: string; ok: boolean; error?: string }> = [];

  for (const server of config.servers) {
    try {
      const tools = await manager.connectServer(server);
      for (const tool of tools) {
        const fullName = manager.getToolFullName(server.name, tool.toolName);
        const def = buildToolDef(fullName, server.name, tool);
        const mcpTool = new McpTool(
          def,
          async (input) => {
            return manager.callTool(server.name, tool.toolName, input);
          },
        );
        registry.register(mcpTool);
      }
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
  registry: ToolRegistry,
  manager: ClientManager,
  server: McpServerDef,
  cwd: string,
): Promise<void> {
  const tools = await manager.connectServer(server);

  for (const tool of tools) {
    const fullName = manager.getToolFullName(server.name, tool.toolName);
    const def = buildToolDef(fullName, server.name, tool);
    const mcpTool = new McpTool(
      def,
      async (input) => {
        return manager.callTool(server.name, tool.toolName, input);
      },
    );
    registry.register(mcpTool);
  }

  saveMcpConfig(server, cwd);
}

export async function removeMcpServer(
  registry: ToolRegistry,
  manager: ClientManager,
  serverName: string,
): Promise<void> {
  const tools = manager.getTools(serverName);
  for (const tool of tools) {
    const fullName = manager.getToolFullName(serverName, tool.toolName);
    registry.unregister(fullName);
  }
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

function buildToolDef(
  fullName: string,
  serverName: string,
  tool: { toolName: string; description?: string | undefined; inputSchema: Record<string, unknown> },
): ToolDef {
  const schema = tool.inputSchema;
  const inputSchema: Record<string, unknown> = {};
  if (schema.type === undefined) {
    inputSchema.type = "object";
  }
  for (const key of Object.keys(schema)) {
    inputSchema[key] = (schema as Record<string, unknown>)[key];
  }

  const def: ToolDef = {
    name: fullName,
    description: tool.description || `MCP tool: ${tool.toolName} from ${serverName}`,
    input_schema: inputSchema as ToolDef["input_schema"],
    deferred: true,
  };
  return def;
}
