import { execSync } from "node:child_process";
import { BaseTool } from "../types.js";
import type { InputSchema } from "../types.js";

export class RunShellTool extends BaseTool {
  name = "run_shell";
  description =
    "Execute a shell command and return its output. Use this for running tests, installing packages, git operations, etc.";
  input_schema: InputSchema = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["command"],
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const command = input.command as string;
    const timeoutMs = (input.timeout as number) ?? 30000;

    try {
      const result = execSync(command, {
        encoding: "utf-8",
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      } as any);
      return result || "(no output)";
    } catch (err: any) {
      if (err.status !== undefined) {
        const stdout: string = err.stdout || "";
        const stderr: string = err.stderr || "";
        let msg = `Command failed (exit code ${err.status})`;
        if (stdout) msg += `\n${stdout}`;
        if (stderr) msg += `\nStderr: ${stderr}`;
        return msg;
      }
      if (err.killed) {
        return `Command timed out after ${timeoutMs}ms`;
      }
      return `Error: ${err.message}`;
    }
  }
}
