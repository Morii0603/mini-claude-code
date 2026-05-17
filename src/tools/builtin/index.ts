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

import { SaveMemoryTool } from "./save_memory.js";
import type { BaseTool } from "../types.js";

export function getAllTools(): BaseTool[] {
  return [
    new GetWeatherTool(),
    new ReadFileTool(),
    new WriteFileTool(),
    new EditFileTool(),
    new ListFilesTool(),
    new GrepSearchTool(),
    new RunShellTool(),
    new WebFetchTool(),
    new EnterPlanModeTool(),
    new ExitPlanModeTool(),
    new SaveMemoryTool(),
    new LoadSkillTool()
  ];
}
