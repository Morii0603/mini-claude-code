import * as readline from "readline";
import type { BaseTool, PermissionMode } from "./tools/types.js";
import { printWelcome, printUserPrompt, printError, printInfo } from "./ui.js";
import { LLMAgent } from "./agent.js";
import { SubAgent } from "./subagent.js";
import { getAllTools } from "./tools/builtin/index.js";
import { loadConfig, getActiveModel, switchModel, runSetupWizard, addModelWizard } from "./config.js";
import type { AppConfig } from "./config.js";
import { initMcp, addMcpServer, listMcpServers, removeMcpServer } from "./mcp/index.js";
import { getMemoryManager } from "./memory.js";
import { getSkillRegistry } from "./skills.js";
import { ClientManager } from "./mcp/client-manager.js";
import type { McpServerDef } from "./mcp/types.js";

function parseMcpAddArgs(input: string): McpServerDef {
  // Parse: <name> <transport> key="value" key2='{"a":1}'
  // Splits on spaces but respects both " and ' quoted strings
  const parts: string[] = [];
  let i = 0;
  while (i < input.length) {
    // skip whitespace
    while (i < input.length && input[i] === " ") i++;
    if (i >= input.length) break;

    let chunk: string;
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i]!;
      i++; // skip opening quote
      let start = i;
      while (i < input.length && input[i] !== quote) i++;
      chunk = input.slice(start, i);
      i++; // skip closing quote

      // Support escaped quotes inside the value: \" or \'
      chunk = chunk.replace(new RegExp(`\\\\${quote}`, "g"), quote);
    } else {
      let start = i;
      while (i < input.length && input[i] !== " ") i++;
      chunk = input.slice(start, i);
    }
    parts.push(chunk);
  }

  if (parts.length < 2) {
    throw new Error("Usage: /mcp add <name> <transport> [key=value ...]");
  }

  const name = parts[0]!;
  const transport = parts[1]! as McpServerDef["transport"];
  if (!["stdio", "streamable-http", "sse"].includes(transport)) {
    throw new Error(`Unknown transport: "${transport}". Use stdio, streamable-http, or sse.`);
  }

  const kwargs: Record<string, string> = {};
  for (let j = 2; j < parts.length; j++) {
    const chunk = parts[j]!;
    const eqIdx = chunk.indexOf("=");
    if (eqIdx < 0) {
      throw new Error(`Expected key=value, got: ${chunk}`);
    }
    const key = chunk.slice(0, eqIdx);
    const val = chunk.slice(eqIdx + 1);
    kwargs[key] = val;
  }

  if (transport === "stdio") {
    if (!kwargs.command) throw new Error("stdio transport requires command=<executable>");
    const args: string[] | undefined = kwargs.args ? JSON.parse(kwargs.args) : undefined;
    const env: Record<string, string> | undefined = kwargs.env ? JSON.parse(kwargs.env) : undefined;
    const result: McpServerDef = { name, transport: "stdio", command: kwargs.command };
    if (args) (result as { args?: string[] }).args = args;
    if (env) (result as { env?: Record<string, string> }).env = env;
    return result;
  }

  if (!kwargs.url) throw new Error(`${transport} transport requires url=<url>`);
  const headers: Record<string, string> | undefined = kwargs.headers
    ? JSON.parse(kwargs.headers)
    : undefined;
  const result: McpServerDef = { name, transport, url: kwargs.url };
  if (headers) (result as { headers?: Record<string, string> }).headers = headers;
  return result;
}

/** Rebuild the agent's tools array from builtin + MCP + ToolSearchTool. */
function rebuildTools(
  agent: LLMAgent,
  mcpManager: ClientManager,
): BaseTool[] {
  const builtinTools = getAllTools();
  const mcpTools = mcpManager.getAllMcpTools();
  const allTools = [...builtinTools, ...mcpTools];
  agent.setTools(allTools);
  return allTools;
}

async function runRepl(
  agent: LLMAgent,
  config: AppConfig,
  mcpManager: ClientManager,
  cwd: string,
) {
    // 获取命令行输入
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    // Ctrl+C 停止当前对话，连续两次退出程序
    let sigintCount = 0;
    let lastSigintTime = 0;

    const askQuestion = (): void => {
        printUserPrompt();
        rl.once("line", async (line) => {
        const input = line.trim();
        sigintCount = 0;

        if (!input) {
            askQuestion();
            return;
        }
        if (input === "exit" || input === "quit") {
            console.log("\nBye!\n");
            rl.close();
            process.exit(0);
        }

        // REPL commands
        if (input === "/clear") {
            agent.clearHistory();
            askQuestion();
            return;
        }
        if (input === "/memory") {
            const mgr = getMemoryManager();
            const memories = mgr.listMemories();
            if (memories.length === 0) {
              console.log("\n  No memories saved yet.");
              console.log(`  Memory dir: ${mgr.dir}\n`);
            } else {
              console.log(`\n  ${memories.length} memories (${mgr.dir}):\n`);
              for (const m of memories) {
                console.log(`  [${m.type}] ${m.name} — ${m.description}`);
              }
              console.log();
            }
            askQuestion();
            return;
        }
        if (input.startsWith("/memory delete ")) {
            const name = input.slice(15).trim();
            if (!name) {
              console.log("  Usage: /memory delete <name>");
              askQuestion();
              return;
            }
            const mgr = getMemoryManager();
            const deleted = mgr.deleteMemory(name);
            if (deleted) {
              console.log(`  Deleted memory '${name}'.`);
            } else {
              console.log(`  Memory '${name}' not found.`);
            }
            askQuestion();
            return;
        }
        if (input === "/compact") {
            try {
            await agent.compactConversation();
            } catch (e: any) {
            printError(e.message);
            }
            askQuestion();
            return;
        }

        if (input === "/mcp") {
            const servers = listMcpServers(mcpManager);
            if (servers.length === 0) {
              console.log("\n  No MCP servers configured.");
              console.log("  Use /mcp add to add one.\n");
            } else {
              console.log(`\n  ${servers.length} MCP server(s):\n`);
              for (const s of servers) {
                const transport = s.config.transport;
                const detail =
                  transport === "stdio"
                    ? `${s.config.command} ${(s.config.args || []).join(" ")}`
                    : s.config.url;
                console.log(`  ${s.name} (${transport}: ${detail})`);
                if (s.tools.length === 0) {
                  console.log("    (no tools)");
                } else {
                  for (const t of s.tools) {
                    const desc = t.description ? ` — ${t.description}` : "";
                    console.log(`    - mcp_${s.name}_${t.name}${desc}`);
                  }
                }
                console.log();
              }
            }
            askQuestion();
            return;
          }

          if (input.startsWith("/mcp add")) {
            const rest = input.slice(8).trim();
            if (!rest) {
              console.log("\n  Usage: /mcp add <name> <transport> key=value...");
              console.log("");
              console.log("  Transports:");
              console.log("    stdio           - local subprocess (command, args, env)");
              console.log("    streamable-http - HTTP with SSE Streaming");
              console.log("    sse             - legacy Server-Sent Events (deprecated)");
              console.log("");
              console.log("  Examples:");
              console.log('    /mcp add filesystem stdio command=npx args=\'["-y","@anthropic/server-filesystem","/tmp"]\'');
              console.log('    /mcp add github streamable-http url=https://api.github.com/mcp headers=\'{"Authorization":"Bearer tok"}\'');
              console.log('    /mcp add my-sse sse url=https://example.com/sse');
              console.log("");
              console.log("  For complex configs, edit .mini-claude/mcp.json directly.");
              askQuestion();
              return;
            }

            try {
              const server = parseMcpAddArgs(rest);
              await addMcpServer(mcpManager, server, cwd);
              rebuildTools(agent, mcpManager);
              console.log(`  MCP server "${server.name}" added and connected.`);
            } catch (e: any) {
              printError(e.message);
            }
            askQuestion();
            return;
          }

          if (input.startsWith("/mcp remove ")) {
            const name = input.slice(12).trim();
            if (!name) {
              console.log("  Usage: /mcp remove <name>");
              askQuestion();
              return;
            }
            try {
              await removeMcpServer(mcpManager, name);
              rebuildTools(agent, mcpManager);
              console.log(`  MCP server "${name}" removed.`);
            } catch (e: any) {
              printError(e.message);
            }
            askQuestion();
            return;
          }

          if (input.startsWith("/mode")) {
            const arg = input.slice(5).trim();
            const modeMap: Record<string, PermissionMode> = {
                "": "default",
                default: "default",
                yolo: "bypassPermissions",
                bypass: "bypassPermissions",
                plan: "plan",
                "accept-edits": "acceptEdits",
                "dont-ask": "dontAsk",
            };
            const mode = modeMap[arg];
            if (mode) {
                agent.setPermissionMode(mode);
                console.log(`  Permission mode: ${mode}`);
            } else {
                console.log(`  Unknown mode: "${arg}". Options: default, yolo, plan, accept-edits, dont-ask`);
            }
            askQuestion();
            return;
        }

        if (input === "/model") {
            console.log("\n  Available models:");
            for (const m of config.models) {
                const marker = m.name === config.activeModel ? " *" : "  ";
                console.log(`  ${marker} ${m.name} — ${m.model} (${m.baseURL})`);
            }
            console.log("\n  Use /model <name> to switch, or /model add to add a new one.");
            askQuestion();
            return;
        }

        if (input.startsWith("/model ")) {
            const arg = input.slice(7).trim();
            if (arg === "add") {
                await addModelWizard(config);
                const active = getActiveModel(config);
                agent.reconfigure(active.baseURL, active.apiKey, active.model);
                printInfo(`Switched to ${active.name} (${active.model})`);
            } else {
                const found = switchModel(config, arg);
                if (found) {
                    agent.reconfigure(found.baseURL, found.apiKey, found.model);
                    printInfo(`Switched to ${found.name} (${found.model})`);
                } else {
                    console.log(`  Unknown model: "${arg}". Use /model to list available models.`);
                }
            }
            askQuestion();
            return;
        }


        if (input === "/skills") {
            const skillReg = getSkillRegistry();
            const skills = skillReg.listAll();
            if (skills.length === 0) {
              console.log("\n  No skills found.");
              console.log("  Add skills to .mini-claude/skills/<name>/SKILL.md\n");
            } else {
              console.log(`\n  ${skills.length} skills:\n`);
              for (const s of skills) {
                const tag = s.userInvocable ? `/${s.name}` : s.name;
                console.log(`  ${tag} (${s.source}) — ${s.description}`);
              }
              console.log();
            }
            askQuestion();
            return;
        }



        try {
            await agent.chat(input);
        } catch (e: any) {
            if (e.name === "AbortError" || e.message?.includes("aborted")) {
            // Already handled by SIGINT handler
            } else {
                printError(e.message);
            }
        }

        askQuestion();
        });
    };

    // Ctrl+C: 停止当前对话，连续两次退出程序
    const handleSigint = () => {
        const now = Date.now();
        // 防止 rl 和 process 同时触发 SIGINT 时重复处理
        if (now - lastSigintTime < 100) return;
        lastSigintTime = now;

        if (agent.isProcessing) {
            agent.abort();
            console.log("\n  (interrupted)");
            sigintCount = 0;

        } else {
            sigintCount++;
            if (sigintCount >= 2) {
                console.log("\n  Bye!\n");
                process.exit(0);
            }
            console.log("\n  Press Ctrl+C again to exit.");
            askQuestion();
        }
    };

    rl.on("SIGINT", handleSigint);
    process.on("SIGINT", handleSigint);

    askQuestion();

}

export async function main() {
    printWelcome();

    let config = loadConfig();
    if (!config) {
        config = await runSetupWizard();
    }

    const activeModel = getActiveModel(config);
    const cwd = process.cwd();

    // Builtin tools
    const builtinTools = getAllTools();

    // Initialize MCP and get MCP tools
    const mcpManager = await initMcp(cwd);
    const mcpTools = mcpManager.getAllMcpTools();

    // Combine for initial agent creation
    const allTools = [...builtinTools, ...mcpTools];

    // Wire sub-agent: restricted tools (no "agent" tool)

    // Create the main agent
    const agent = new LLMAgent({
        baseURL: activeModel.baseURL,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        thinking: true,
        tools: allTools,
        subagent: new SubAgent({
          baseURL: activeModel.baseURL,
          apiKey: activeModel.apiKey,
          model: activeModel.model,
          thinking: true,
          tools: allTools.filter((t) => t.name !== "agent"),
        }),
    });

    // Register ToolSearchTool with the agent's state




    printInfo(`Model: ${activeModel.name} (${activeModel.model})`);

    await runRepl(agent, config, mcpManager, cwd);
}
