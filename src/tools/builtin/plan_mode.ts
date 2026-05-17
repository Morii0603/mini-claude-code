import { BaseTool } from "../types.js";

export class EnterPlanModeTool extends BaseTool {
  name = "enter_plan_mode";
  description =
    "Enter plan mode to switch to a read-only planning phase. In plan mode, you can only read files and write to the plan file. Use this when you need to explore the codebase and design an implementation plan before making changes.";
  input_schema = {
    type: "object" as const,
    properties: {},
  };
  defer_loading = true;

  async run(_input: Record<string, unknown>): Promise<string> {
    return "pass";
  }
}

export class ExitPlanModeTool extends BaseTool {
  name = "exit_plan_mode";
  description =
    "Exit plan mode after you have finished writing your plan to the plan file. The user will review and approve the plan before you proceed with implementation.";
  input_schema = {
    type: "object" as const,
    properties: {},
  };
  defer_loading = true;

  async run(_input: Record<string, unknown>): Promise<string> {
    return "pass";
  }
}
