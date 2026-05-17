import { BaseTool } from "../types.js";
import type { BaseAgent } from "../../agent.js";

export class AgentTool extends BaseTool {
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

  private subagentFactory: (() => BaseAgent) | null = null;

  /** Set the factory used to create fresh sub-agents for each invocation. */
  setSubAgentFactory(factory: () => BaseAgent): void {
    this.subagentFactory = factory;
  }

  async run(input: Record<string, unknown>): Promise<string> {
    const description = input.description as string;
    const prompt = input.prompt as string;

    if (!this.subagentFactory) {
      return `[Sub-agent "${description}" not available — sub-agent factory not configured.]`;
    }

    try {
      const subagent = this.subagentFactory();
      const result = await subagent.run(prompt);
      return result;
    } catch (error: any) {
      return `[Sub-agent "${description}" failed: ${error.message}]`;
    }
  }
}
