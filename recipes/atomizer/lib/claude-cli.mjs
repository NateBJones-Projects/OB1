/**
 * Shared Claude CLI spawn utilities for the atomizer recipe.
 *
 * Pattern copied from common import scripts: we shell out to the `claude`
 * CLI, pipe the prompt via stdin (to dodge shell-escape hell on Windows),
 * and strip the environment variables that Claude CLI uses to detect a
 * nested session — otherwise it refuses to run.
 */

import { spawn } from "node:child_process";

/**
 * Environment variable keys that must be stripped from child processes
 * to prevent Claude CLI from detecting it's inside a Claude Code session.
 */
export const STRIP_KEYS = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES",
  "CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_AGENT_SDK_VERSION",
]);

/**
 * Build a clean child environment with session-detection vars stripped.
 */
export function buildCleanEnv() {
  const childEnv = { ...process.env };
  for (const key of STRIP_KEYS) {
    delete childEnv[key];
  }
  return childEnv;
}

/**
 * Spawn Claude CLI as a child process.
 *
 * @param {string[]} args - full command args (first element is the executable)
 * @param {object} env - environment variables
 * @param {number} timeoutMs - timeout in ms (default 180s)
 * @param {string} [stdinData] - optional data to pipe to stdin
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export function spawnClaudeCli(args, env, timeoutMs = 180_000, stdinData = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      stdio: [stdinData ? "pipe" : "ignore", "pipe", "pipe"],
      env,
      shell: true,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    if (stdinData && child.stdin) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      killed = true;
      child.kill();
      reject(new Error(`Claude CLI timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Claude CLI spawn error: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code !== 0) {
        // Don't leak stdout/stderr into the error message by default — the
        // Claude CLI often echoes the input prompt, which for this recipe
        // contains arbitrary user memory / email text. Set ATOMIZE_DEBUG=1
        // to include the raw snippets when actively debugging.
        const debug = process.env.ATOMIZE_DEBUG === "1";
        const detail = debug
          ? `\nStderr: ${stderr.substring(0, 500)}\nStdout: ${stdout.substring(0, 200)}`
          : ` (stderr ${stderr.length}B, stdout ${stdout.length}B — set ATOMIZE_DEBUG=1 to see)`;
        reject(new Error(`Claude CLI exited with code ${code}.${detail}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
