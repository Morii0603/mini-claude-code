import * as readline from "readline";
import type { PermissionMode } from "./tools/types.js";
import { printWelcome, printUserPrompt, printError, printInfo } from "./ui.js";
import { AgentLoop } from "./agent.js";
import { ToolRegistry } from "./tools/registry.js";
import { registerAll } from "./tools/builtin/index.js";
import { loadConfig, getActiveModel, switchModel, runSetupWizard, addModelWizard } from "./config.js";
import type { AppConfig } from "./config.js";


async function runRepl(agent: AgentLoop, config: AppConfig) {
    // 获取命令行输入
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    // Provide confirmFn that reuses this readline instance, avoiding the
    // classic Node.js bug where a second readline on the same stdin kills
    // the first one when closed.


    // Ctrl+C 停止当前对话，连续两次退出程序
    let sigintCount = 0;
    process.on("SIGINT", () => {
    if (agent.isProcessing) {
        agent.abort();
        console.log("\n  (interrupted)");
        sigintCount = 0;
        printUserPrompt();
    } else {
        sigintCount++;
        if (sigintCount >= 2) {
        console.log("\nBye!\n");
        process.exit(0);
        }
        console.log("\n  Press Ctrl+C again to exit.");
        printUserPrompt();
    }
    });

//   // Plan approval callback: interactive multi-option selection
//   agent.setPlanApprovalFn((planContent: string) => {
//     return new Promise((resolve) => {
//       printPlanForApproval(planContent);
//       printPlanApprovalOptions();

//       const askChoice = () => {
//         rl.question("  Enter choice (1-4): ", (answer) => {
//           const choice = answer.trim();
//           if (choice === "1") {
//             resolve({ choice: "clear-and-execute" });
//           } else if (choice === "2") {
//             resolve({ choice: "execute" });
//           } else if (choice === "3") {
//             resolve({ choice: "manual-execute" });
//           } else if (choice === "4") {
//             rl.question("  Feedback (what to change): ", (feedback) => {
//               resolve({ choice: "keep-planning", feedback: feedback.trim() || undefined });
//             });
//           } else {
//             console.log("  Invalid choice. Enter 1, 2, 3, or 4.");
//             askChoice();
//           }
//         });
//       };
//       askChoice();
//     });
//   });

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
        // if (input === "/plan") {
        //     const newMode = agent.togglePlanMode();
        //     askQuestion();
        //     return;
        // }
        // if (input === "/cost") {
        //     agent.showCost();
        //     askQuestion();
        //     return;
        // }
        if (input === "/compact") {
            try {
            await agent.compactConversation();
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

        // if (input === "/memory") {
        //     const memories = listMemories();
        //     if (memories.length === 0) {
        //     printInfo("No memories saved yet.");
        //     } else {
        //     printInfo(`${memories.length} memories:`);
        //     for (const m of memories) {
        //         console.log(`    [${m.type}] ${m.name} — ${m.description}`);
        //     }
        //     }
        //     askQuestion();
        //     return;
        // }
        // if (input === "/skills") {
        //     const skills = discoverSkills();
        //     if (skills.length === 0) {
        //     printInfo("No skills found. Add skills to .claude/skills/<name>/SKILL.md");
        //     } else {
        //     printInfo(`${skills.length} skills:`);
        //     for (const s of skills) {
        //         const tag = s.userInvocable ? `/${s.name}` : s.name;
        //         console.log(`    ${tag} (${s.source}) — ${s.description}`);
        //     }
        //     }
        //     askQuestion();
        //     return;
        // }

        // Skill invocation: /<skill-name> [args]
        // if (input.startsWith("/")) {
        //     const spaceIdx = input.indexOf(" ");
        //     const cmdName = spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1);
        //     const cmdArgs = spaceIdx > 0 ? input.slice(spaceIdx + 1) : "";
        //     const skill = getSkillByName(cmdName);
        //     if (skill && skill.userInvocable) {
        //     printInfo(`Invoking skill: ${skill.name}`);
        //     try {
        //         if (skill.context === "fork") {
        //         // Fork mode: use skill tool which creates a sub-agent
        //         const forkResult = executeSkill(skill.name, cmdArgs);
        //         if (forkResult) {
        //             await agent.chat(`Use the skill tool to invoke "${skill.name}" with args: ${cmdArgs || "(none)"}`);
        //         }
        //         } else {
        //         // Inline mode: inject resolved prompt
        //         const resolved = resolveSkillPrompt(skill, cmdArgs);
        //         await agent.chat(resolved);
        //         }
        //     } catch (e: any) {
        //         if (e.name !== "AbortError" && !e.message?.includes("aborted")) {
        //         printError(e.message);
        //         }
        //     }
        //     askQuestion();
        //     return;
        //     }
        //     // Unknown command — treat as regular input
        // }

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

    askQuestion();

}
export async function main() {
    printWelcome();

    let config = loadConfig();
    if (!config) {
        config = await runSetupWizard();
    }

    const activeModel = getActiveModel(config);

    const registry = new ToolRegistry();
    registerAll(registry);
    const agent = new AgentLoop({
        baseURL: activeModel.baseURL,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        thinking: true,
        toolRegistry: registry,
    });

    printInfo(`Model: ${activeModel.name} (${activeModel.model})`);

    await runRepl(agent, config);
}
