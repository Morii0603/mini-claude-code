export type McpTransport = "stdio" | "streamable-http" | "sse";

export interface McpStdioConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpConfig {
  transport: "streamable-http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerDef = {
  name: string;
  description?: string;
} & (McpStdioConfig | McpHttpConfig);

export interface McpConfig {
  servers: McpServerDef[];
}
