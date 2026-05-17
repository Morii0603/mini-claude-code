import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";
import { getSkillRegistry } from "../../skills.js";

const loadSkillDef: ToolDef = {
  name: "load_skill",
  description:
    "Load the full body of a named skill into the current context. Use this before following a skill's instructions — skills are prompt templates that guide specific workflows (e.g. commit, code review).",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the skill to load (e.g. 'commit', 'review')",
      },
    },
    required: ["name"],
  },
};

export class LoadSkillTool extends BaseTool {
  def: ToolDef = loadSkillDef;

  async run(input: Record<string, unknown>): Promise<string> {
    const name = input.name as string;
    const registry = getSkillRegistry();
    return registry.loadFullText(name);
  }
}
