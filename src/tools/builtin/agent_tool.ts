import { BaseTool } from "../types.js";
import type { BaseAgent } from "../../agent.js";

export class AgentTool extends BaseTool {
  subagent: BaseAgent;
  name = "agent";
  description =
    "Launch a sub-agent to handle a task autonomously. Sub-agents have isolated context and return their result. Sub-agents cannot spawn further sub-agents.";
  input_schema = {
    type: "object" as const,
    properties: {
      description: {
        type: "string",
        description: "Short (3-5 word) description of the sub-agent's task",
      },
      prompt: {
        type: "string",
        description: "Detailed task instructions for the sub-agent",
      },
    },
    required: ["description", "prompt"],
  };

  constructor(subagent: BaseAgent) {
    super();
    this.subagent = subagent;
  }

  async run(input: Record<string, unknown>): Promise<string> {
    const description = input.description as string;
    const prompt = input.prompt as string;



    try {
      const subagent = this.subagent;
      const result = await subagent.run(prompt);
      return result;
    } catch (error: any) {
      return `[Sub-agent "${description}" failed: ${error.message}]`;
    }
  }
}
