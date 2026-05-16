import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";

const enterPlanModeDef: ToolDef = {
  name: "enter_plan_mode",
  description:
    "Enter plan mode to switch to a read-only planning phase. In plan mode, you can only read files and write to the plan file. Use this when you need to explore the codebase and design an implementation plan before making changes.",
  input_schema: {
    type: "object",
    properties: {},
  },
  deferred: true,
};

const exitPlanModeDef: ToolDef = {
  name: "exit_plan_mode",
  description:
    "Exit plan mode after you have finished writing your plan to the plan file. The user will review and approve the plan before you proceed with implementation.",
  input_schema: {
    type: "object",
    properties: {},
  },
  deferred: true,
};

export class EnterPlanModeTool extends BaseTool {
  def: ToolDef = enterPlanModeDef;

  async run(_input: Record<string, unknown>): Promise<string> {
    return "[enter_plan_mode not yet implemented]";
  }
}

export class ExitPlanModeTool extends BaseTool {
  def: ToolDef = exitPlanModeDef;

  async run(_input: Record<string, unknown>): Promise<string> {
    return "[exit_plan_mode not yet implemented]";
  }
}
