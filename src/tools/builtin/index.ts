import type { ToolRegistry } from "../registry.js";
import { GetWeatherTool } from "./get_weather.js";
import { ReadFileTool } from "./read_file.js";
import { WriteFileTool } from "./write_file.js";
import { EditFileTool } from "./edit_file.js";
import { ListFilesTool } from "./list_files.js";
import { GrepSearchTool } from "./grep_search.js";
import { RunShellTool } from "./run_shell.js";
import { WebFetchTool } from "./web_fetch.js";
import { LoadSkillTool } from "./skill.js";
import { EnterPlanModeTool, ExitPlanModeTool } from "./plan_mode.js";
import { AgentTool } from "./agent_tool.js";
import { SaveMemoryTool } from "./save_memory.js";
import { ToolSearchTool } from "./tool_search.js";

export function registerAll(registry: ToolRegistry): void {
  registry.register(new GetWeatherTool());
  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new ListFilesTool());
  registry.register(new GrepSearchTool());
  registry.register(new RunShellTool());
  registry.register(new WebFetchTool());
  registry.register(new EnterPlanModeTool());
  registry.register(new ExitPlanModeTool());
  registry.register(new AgentTool());
  registry.register(new SaveMemoryTool());
  registry.register(new LoadSkillTool());
  registry.register(new ToolSearchTool(registry));
}
