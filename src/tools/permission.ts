import { existsSync } from "fs";
import type { PermissionMode } from "./types.js";

/** Tools that only read data — always allowed in all modes. */
export const READ_TOOLS = new Set([
  "read_file",
  "list_files",
  "grep_search",
  "tool_search",
  "get_weather",
  "web_fetch",
  "skill",
  "agent",
]);

/** Tools that modify files. */
export const EDIT_TOOLS = new Set([
  "write_file",
  "edit_file",
]);

/** Tools gated behind plan mode. */
const PLAN_MODE_TOOLS = new Set([
  "enter_plan_mode",
  "exit_plan_mode",
]);

/**
 * Check permission rules from settings.
 * Returns "allow" or "deny" if a rule matches, or undefined for no match.
 * Deny rules take precedence over allow rules.
 */
function checkPermissionRules(
  toolName: string,
  _input: Record<string, any>,
): "allow" | "deny" | undefined {
  // Simplified: check environment variable for ad-hoc rules.
  // Format: MINI_CLAUDE_PERMISSIONS="deny:run_shell allow:write_file"
  const env = process.env.MINI_CLAUDE_PERMISSIONS;
  if (!env) return undefined;

  let result: "allow" | "deny" | undefined;

  for (const token of env.split(/\s+/)) {
    const [action, name] = token.split(":", 2);
    if (!action || !name) continue;
    if (name === toolName || name === "*") {
      if (action === "deny") return "deny";
      if (action === "allow") result = "allow";
    }
  }

  return result;
}

/**
 * Detect potentially dangerous shell commands that should require confirmation.
 */
export function isDangerous(command: string): boolean {
  const c = command.trim();

  // Destructive filesystem operations
  if (/\brm\s+(-[a-z]*r[a-z]*|[^-\s]*r)\b/i.test(c)) return true;
  if (/\bdd\s+if=/i.test(c)) return true;

  // Privilege escalation
  if (/\bsudo\b/i.test(c)) return true;

  // Permission changes
  if (/\bchmod\b/i.test(c)) return true;
  if (/\bchown\b/i.test(c)) return true;

  // Force-push / destructive git
  if (/\bgit\s+push\s+.*(--force|--force-with-lease)/i.test(c)) return true;
  if (/\bgit\s+reset\s+--hard\b/i.test(c)) return true;
  if (/\bgit\s+clean\s+(.+--|-)(d|x)/i.test(c)) return true;

  // Curl-to-shell pattern
  if (/\bcurl\b.+\|\s*(sh|bash|zsh)\b/i.test(c)) return true;
  if (/\bwget\b.+\|\s*(sh|bash|zsh)\b/i.test(c)) return true;

  // Writing to devices or system paths (outside workspace)
  if (/[>|]\s*\/dev\//.test(c)) return true;
  if (/\bmkfs\./i.test(c)) return true;

  // Package manager global install
  if (/\b(npm|pnpm|yarn)\s+(i|install|add)\s+.*(-g|--global)\b/i.test(c))
    return true;
  if (/\bpip\s+install\b(?!.*--dry-run)/i.test(c)) return true;

  // Dangerous network commands
  if (/\bnc\s+-[a-z]*[el]/i.test(c)) return true; // nc -l / nc -e

  return false;
}

/**
 * Check whether a tool call is allowed given the current permission mode.
 *
 * Rules (in order):
 * 1. bypassPermissions mode — allow everything
 * 2. Permission rules from settings (deny overrides all, allow short-circuits)
 * 3. Read tools — always allowed
 * 4. Plan mode — block write/edit/shell (except plan file edits)
 * 5. Plan mode tools — always allowed
 * 6. acceptEdits — auto-approve file writes/edits
 * 7. Built-in dangerous pattern checks — confirm or deny
 * 8. Default: allow
 */
export function checkPermission(
  toolName: string,
  input: Record<string, any>,
  mode: PermissionMode = "default",
  planFilePath?: string,
): { action: "allow" | "deny" | "confirm"; message?: string } {
  // Step 1: bypassPermissions mode — allow everything
  if (mode === "bypassPermissions") return { action: "allow" };

  // Step 2: Permission rules from settings (deny overrides, allow short-circuits)
  const ruleResult = checkPermissionRules(toolName, input);
  if (ruleResult === "deny") {
    return { action: "deny", message: `Denied by permission rule for ${toolName}` };
  }
  if (ruleResult === "allow") {
    return { action: "allow" };
  }

  // Step 3: Read tools are always allowed
  if (READ_TOOLS.has(toolName)) return { action: "allow" };

  // Step 4: Plan mode — block write/edit/shell (except plan file)
  if (mode === "plan") {
    if (EDIT_TOOLS.has(toolName)) {
      const filePath = input.file_path || input.path;
      if (planFilePath && filePath === planFilePath) {
        return { action: "allow" };
      }
      return { action: "deny", message: `Blocked in plan mode: ${toolName}` };
    }
    if (toolName === "run_shell") {
      return { action: "deny", message: "Shell commands blocked in plan mode" };
    }
  }

  // Step 5: Plan mode tools — always allowed
  if (PLAN_MODE_TOOLS.has(toolName)) {
    return { action: "allow" };
  }

  // Step 6: acceptEdits — auto-approve file writes/edits
  if (mode === "acceptEdits" && EDIT_TOOLS.has(toolName)) {
    return { action: "allow" };
  }

  // Step 7: Built-in dangerous pattern checks
  let needsConfirm = false;
  let confirmMessage = "";

  if (toolName === "run_shell" && isDangerous(input.command)) {
    needsConfirm = true;
    confirmMessage = input.command;
  } else if (toolName === "write_file" && !existsSync(input.file_path)) {
    needsConfirm = true;
    confirmMessage = `write new file: ${input.file_path}`;
  } else if (toolName === "edit_file" && !existsSync(input.file_path)) {
    needsConfirm = true;
    confirmMessage = `edit non-existent file: ${input.file_path}`;
  }

  if (needsConfirm) {
    if (mode === "dontAsk") {
      return { action: "deny", message: `Auto-denied (dontAsk mode): ${confirmMessage}` };
    }
    return { action: "confirm", message: confirmMessage };
  }

  // Step 8: Default — allow
  return { action: "allow" };
}
