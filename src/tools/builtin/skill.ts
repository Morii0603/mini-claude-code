import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";

const skillDef: ToolDef = {
  name: "skill",
  description:
    "Invoke a registered skill by name. Skills are prompt templates loaded from .claude/skills/. Returns the skill's resolved prompt to follow.",
  input_schema: {
    type: "object",
    properties: {
      skill_name: {
        type: "string",
        description: "The name of the skill to invoke",
      },
      args: {
        type: "string",
        description: "Optional arguments to pass to the skill",
      },
    },
    required: ["skill_name"],
  },
};

export class SkillTool extends BaseTool {
  def: ToolDef = skillDef;

  async run(input: Record<string, unknown>): Promise<string> {
    const skillName = input.skill_name as string;
    const args = (input.args as string) || "";
    return `[Skill "${skillName}" not yet implemented. Args: ${args}]`;
  }
}
