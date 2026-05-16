import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerDef } from "./types.js";

interface McpServerState {
  config: McpServerDef;
  client: Client;
  tools: McpToolInfo[];
}

export interface McpToolInfo {
  serverName: string;
  toolName: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
}

function makeToolFullName(serverName: string, toolName: string): string {
  return `mcp_${serverName}_${toolName}`;
}

interface ContentItem {
  type: string;
  text?: string;
}

export class ClientManager {
  private servers = new Map<string, McpServerState>();

  async connectServer(server: McpServerDef): Promise<McpToolInfo[]> {
    if (this.servers.has(server.name)) {
      await this.disconnectServer(server.name);
    }

    const client = new Client(
      { name: "mini-claude-code", version: "1.0.0" },
      { capabilities: {} },
    );

    const transport = this.createTransport(server);
    await client.connect(transport as Transport);

    const result = await client.listTools();
    const tools: McpToolInfo[] = (result.tools || []).map((t) => {
      const info: McpToolInfo = {
        serverName: server.name,
        toolName: t.name,
        inputSchema: (t.inputSchema || { type: "object" }) as Record<string, unknown>,
      };
      if (t.description !== undefined) {
        info.description = t.description;
      }
      return info;
    });

    this.servers.set(server.name, { config: server, client, tools });
    return tools;
  }

  async disconnectServer(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state) return;
    try {
      await state.client.close();
    } catch {
      // ignore close errors
    }
    this.servers.delete(name);
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.all(names.map((n) => this.disconnectServer(n)));
  }

  getServerNames(): string[] {
    return [...this.servers.keys()];
  }

  getTools(serverName: string): McpToolInfo[] {
    return this.servers.get(serverName)?.tools || [];
  }

  getAllTools(): McpToolInfo[] {
    const all: McpToolInfo[] = [];
    for (const state of this.servers.values()) {
      all.push(...state.tools);
    }
    return all;
  }

  getToolFullName(serverName: string, toolName: string): string {
    return makeToolFullName(serverName, toolName);
  }

  getServerConfig(name: string): McpServerDef | undefined {
    return this.servers.get(name)?.config;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const state = this.servers.get(serverName);
    if (!state) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const result = await state.client.callTool({
      name: toolName,
      arguments: args,
    });

    const content = (result as { content: ContentItem[] }).content;
    return this.formatToolResult(content);
  }

  private formatToolResult(content: ContentItem[]): string {
    const parts: string[] = [];
    for (const item of content) {
      if (item.type === "text" && item.text !== undefined) {
        parts.push(item.text);
      } else if (item.type === "image") {
        parts.push("[image]");
      } else if (item.type === "audio") {
        parts.push("[audio]");
      } else {
        parts.push(JSON.stringify(item));
      }
    }
    return parts.join("\n") || "(empty result)";
  }

  private createTransport(server: McpServerDef) {
    switch (server.transport) {
      case "stdio": {
        const params: Record<string, unknown> = {
          command: server.command,
        };
        if (server.args) params["args"] = server.args;
        if (server.env) params["env"] = server.env;
        return new StdioClientTransport(params as never);
      }

      case "streamable-http": {
        const opts: Record<string, unknown> = {};
        if (server.headers) {
          opts["requestInit"] = { headers: server.headers };
        }
        return new StreamableHTTPClientTransport(
          new URL(server.url),
          opts as never,
        );
      }

      case "sse": {
        const opts: Record<string, unknown> = {};
        if (server.headers) {
          opts["requestInit"] = { headers: server.headers };
        }
        return new SSEClientTransport(
          new URL(server.url),
          opts as never,
        );
      }
    }
  }
}
