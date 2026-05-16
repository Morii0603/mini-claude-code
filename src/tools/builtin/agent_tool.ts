import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";

const agentDef: ToolDef = {
  name: "agent",
  description:
    "Launch a sub-agent to handle a task autonomously. Sub-agents have isolated context and return their result. Types: 'explore' (read-only, fast search), 'plan' (read-only, structured planning), 'general' (full tools).",
  input_schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Short (3-5 word) description of the sub-agent's task",
      },
      prompt: {
        type: "string",
        description: "Detailed task instructions for the sub-agent",
      },
      type: {
        type: "string",
        enum: ["explore", "plan", "general"],
        description:
          "Agent type: explore (read-only), plan (planning), general (full tools). Default: general",
      },
    },
    required: ["description", "prompt"],
  },
};

export class AgentTool extends BaseTool {
  def: ToolDef = agentDef;

  async run(input: Record<string, unknown>): Promise<string> {
    const description = input.description as string;
    const prompt = input.prompt as string;
    const type = (input.type as string) || "general";
    return `[Agent "${description}" (${type}) not yet implemented. Prompt: ${prompt.slice(0, 100)}...]`;
  }
}
