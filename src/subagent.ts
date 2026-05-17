import { BaseAgent, type BaseAgentOptions } from "./agent.js";

const SUBAGENT_PROMPT = `You are a sub-agent for Mini Claude Code. Given the user's message, you should use the tools available to complete the task. Complete the task fully — don't gold-plate, but don't leave it half-done. When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: search broadly when you don't know where something lives. Use read_file when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.`;

export class SubAgent extends BaseAgent {
  constructor(options: BaseAgentOptions) {
    super(options);
    this.isSubAgent = true;
    this.outputBuffer = [];
  }

  // ── hooks ────────────────────────────────────────────────────────────

  protected emitText(text: string): void {
    if (this.outputBuffer) {
      this.outputBuffer.push(text);
    }
  }

  protected getSystemPrompt(): string {
    return SUBAGENT_PROMPT;
  }

  /** Sub-agents never prompt the user interactively. */
  protected async confirmDangerous(_command: string): Promise<boolean> {
    return false;
  }

  // ── entry point ──────────────────────────────────────────────────────

  /**
   * Run the sub-agent with the given prompt and return the final text response.
   * Each call resets the conversation context.
   */
  async run(prompt: string): Promise<string> {
    this.aborted = false;
    this.abortController = new AbortController();
    this.outputBuffer = [];
    this.messages = [];
    this.confirmedPaths.clear();

    this.messages.push({ role: "user", content: prompt });

    try {
      await this.runAgentLoop();
    } finally {
      this.abortController = null;
    }

    return this.extractFinalResponse();
  }

}
