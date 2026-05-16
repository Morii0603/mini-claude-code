
import {main} from "./cli.js";
// const registry = new ToolRegistry();
// registerAll(registry);

// const agent = new AgentLoop({
//     baseURL: "https://api.deepseek.com/anthropic",
//     apiKey: "",
//     model: "deepseek-v4-flash",
//     thinking: true,
//     toolRegistry: registry
// });
// agent.chat("当前文件夹下有哪些文件").catch(console.error);

main().catch(console.error);
