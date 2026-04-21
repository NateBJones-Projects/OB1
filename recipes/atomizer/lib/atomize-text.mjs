/**
 * atomize-text.mjs — Reusable LLM atomization for any text content.
 *
 * Splits a block of text into atomic single-topic thoughts using one of three
 * LLM providers. The same function backs ingest-time splitting (pull-*
 * scripts) and offline repair (re-atomize-gmail-thought).
 *
 * Provider selection — "don't cross the streams":
 *   - Inside Codex (CODEX_THREAD_ID set)         → default 'codex'
 *   - Standalone terminal                        → default 'claude-cli'
 *   - Inside Claude Code (CLAUDECODE set)        → throw (use Codex delegation)
 * Explicit opts.provider overrides detection.
 *
 * API:
 *   atomizeText(text, {
 *     prompt,          // system-style prompt; text is appended
 *     provider,        // 'claude-cli' | 'anthropic' | 'openrouter' | 'codex'
 *     timeoutMs,       // default 30_000
 *     minAtoms,        // minimum # of atoms to expect; default 1
 *     anthropicApiKey, // required when provider='anthropic'
 *     anthropicModel,  // default 'claude-sonnet-4-5'
 *     openrouterApiKey,// required when provider='openrouter'
 *     openrouterModel, // default 'anthropic/claude-sonnet-4.5'
 *   }) → Promise<string[]>
 *
 * The LLM receives `${prompt}\n\nINPUT:\n${text}\n\nOUTPUT (JSON array):`.
 * Responses must contain a valid JSON array of non-empty strings.
 */

import { spawn } from "node:child_process";
import { buildCleanEnv, spawnClaudeCli } from "./claude-cli.mjs";

// ── Orchestrator auto-detection ──────────────────────────────────────────────

function detectDefaultProvider() {
  if (process.env.CODEX_THREAD_ID) return "codex";
  return "claude-cli";
}

// ── Default atomization prompt (caller can override) ─────────────────────────

export const DEFAULT_ATOMIZE_PROMPT = `You are splitting a compound thought into atomic single-topic thoughts.

RULES:
- Each output thought must be standalone and self-contained
- Preserve the original wording as much as possible — do not paraphrase
- Do not split causal chains unless each clause works independently
- Do not split definitions that lose meaning when separated
- Preserve sensitive or autobiographical wording exactly
- Each thought should be 1-2 sentences maximum
- Output valid JSON array of strings only, no other text
- If the input is already a single atomic thought, return a one-element array`;

// ── Nested-execution guard ───────────────────────────────────────────────────

function inClaudeCodeSession() {
  return !!(
    process.env.CLAUDE_CODE_SESSION_ID ||
    process.env.CLAUDECODE ||
    process.env.CLAUDE_CODE_ENTRYPOINT
  );
}

// ── JSON array extractor ─────────────────────────────────────────────────────

function parseAtomsFromResponse(raw) {
  if (typeof raw !== "string") {
    throw new Error(`expected string response from LLM, got ${typeof raw}`);
  }
  // The LLM may wrap the array in prose or code fences. Pull the first [...] match.
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`no JSON array found in LLM response (first 200 chars): ${raw.slice(0, 200)}`);
  }
  let atoms;
  try {
    atoms = JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`LLM returned invalid JSON: ${err.message}`);
  }
  if (!Array.isArray(atoms)) {
    throw new Error(`LLM returned non-array: ${typeof atoms}`);
  }
  const cleaned = atoms
    .filter((a) => typeof a === "string")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (cleaned.length === 0) {
    throw new Error("LLM returned empty array after filtering");
  }
  return cleaned;
}

// ── Provider: claude-cli ─────────────────────────────────────────────────────

async function atomizeViaClaudeCli(text, { prompt, timeoutMs }) {
  // Pipe the prompt via stdin instead of the -p command-line arg. Multi-line
  // prompts with quotes and newlines get mangled under Windows shell:true.
  // Stdin avoids all shell escaping.
  const fullPrompt = `${prompt}\n\nINPUT THOUGHT:\n${text}\n\nOUTPUT (JSON array of atomic thoughts):`;
  const { stdout } = await spawnClaudeCli(
    [process.env.CLAUDE_CLI_PATH || "claude", "-p"],
    buildCleanEnv(),
    timeoutMs,
    fullPrompt,
  );
  return parseAtomsFromResponse(stdout);
}

// ── Provider: codex (OpenAI via codex exec) ──────────────────────────────────

async function atomizeViaCodex(text, { prompt, timeoutMs }) {
  // Codex is the natural choice when this script is itself being orchestrated
  // by Codex — no nested-Claude tunneling, no stdin/shell-escape issues with
  // claude-cli. Requires `codex` on PATH.
  const fullPrompt = `${prompt}\n\nINPUT THOUGHT:\n${text}\n\nRespond with ONLY a JSON array of strings. No prose, no markdown fences, no commentary. Example: ["thought one", "thought two"]`;

  return await new Promise((resolve, reject) => {
    // shell:true needed so Windows PATHEXT resolves `codex` → `codex.cmd`.
    const codexPath = process.env.CODEX_CLI_PATH || "codex";
    const child = spawn(
      codexPath,
      ["exec", "--dangerously-bypass-approvals-and-sandbox", "-"],
      { stdio: ["pipe", "pipe", "pipe"], shell: true },
    );
    let stdout = "";
    let stderr = "";
    let killed = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdin.write(fullPrompt);
    child.stdin.end();
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
      reject(new Error(`codex exec timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`codex spawn error: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code !== 0) {
        reject(new Error(
          `codex exec exited with code ${code}.\nStderr: ${stderr.slice(0, 500)}\nStdout: ${stdout.slice(0, 300)}`,
        ));
        return;
      }
      try {
        resolve(parseAtomsFromResponse(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ── Provider: anthropic (direct API) ─────────────────────────────────────────

async function atomizeViaAnthropic(text, { prompt, timeoutMs, anthropicApiKey, anthropicModel }) {
  if (!anthropicApiKey) {
    throw new Error("atomizeText: provider='anthropic' requires opts.anthropicApiKey");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 2048,
        system: prompt,
        messages: [
          { role: "user", content: `INPUT THOUGHT:\n${text}\n\nOUTPUT (JSON array of atomic thoughts):` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`anthropic API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const content = Array.isArray(data.content) ? data.content : [];
    const text_block = content.find((b) => b.type === "text");
    if (!text_block) throw new Error("anthropic response had no text block");
    return parseAtomsFromResponse(text_block.text);
  } finally {
    clearTimeout(timer);
  }
}

// ── Provider: openrouter (HTTP API) ──────────────────────────────────────────
//
// OpenRouter is the canonical OB1 provider (same key as the rest of the OB
// setup), so most community installs will prefer this path over direct
// Anthropic. Uses the OpenAI-compatible /chat/completions endpoint.

async function atomizeViaOpenRouter(text, { prompt, timeoutMs, openrouterApiKey, openrouterModel }) {
  if (!openrouterApiKey) {
    throw new Error("atomizeText: provider='openrouter' requires opts.openrouterApiKey");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/NateBJones-Projects/OB1",
        "X-Title": "OB1 Atomizer",
      },
      body: JSON.stringify({
        model: openrouterModel,
        max_tokens: 2048,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `INPUT THOUGHT:\n${text}\n\nOUTPUT (JSON array of atomic thoughts):` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`openrouter API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    const content = choice?.message?.content;
    if (!content) throw new Error("openrouter response had no message content");
    return parseAtomsFromResponse(content);
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Atomize a block of text into a list of atomic strings.
 * Returns a one-element array if the LLM judges the text already-atomic.
 *
 * @param {string} text
 * @param {object} opts
 * @param {string} [opts.prompt] Override the default atomize prompt.
 * @param {"claude-cli"|"anthropic"|"openrouter"|"codex"} [opts.provider] Auto-detected when omitted.
 * @param {number} [opts.timeoutMs=30000]
 * @param {number} [opts.minAtoms=1]
 * @param {string} [opts.anthropicApiKey]
 * @param {string} [opts.anthropicModel="claude-sonnet-4-5"]
 * @param {string} [opts.openrouterApiKey]
 * @param {string} [opts.openrouterModel="anthropic/claude-sonnet-4.5"]
 * @returns {Promise<string[]>}
 */
export async function atomizeText(text, opts = {}) {
  const {
    prompt = DEFAULT_ATOMIZE_PROMPT,
    provider = detectDefaultProvider(),
    timeoutMs = 30_000,
    minAtoms = 1,
    anthropicApiKey,
    anthropicModel = "claude-sonnet-4-5",
    openrouterApiKey,
    openrouterModel = "anthropic/claude-sonnet-4.5",
  } = opts;

  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("atomizeText: text must be a non-empty string");
  }
  const KNOWN = new Set(["claude-cli", "anthropic", "openrouter", "codex"]);
  if (!KNOWN.has(provider)) {
    throw new Error(`atomizeText: unknown provider '${provider}'`);
  }
  if (provider === "claude-cli" && inClaudeCodeSession()) {
    throw new Error(
      "atomizeText: claude-cli cannot be invoked from inside a Claude Code " +
      "session (nested detection / OAuth will fail). Run from a standalone " +
      "terminal, delegate to Codex, or pass provider='anthropic' | 'openrouter'.",
    );
  }

  let atoms;
  if (provider === "claude-cli") {
    atoms = await atomizeViaClaudeCli(text, { prompt, timeoutMs });
  } else if (provider === "anthropic") {
    atoms = await atomizeViaAnthropic(text, { prompt, timeoutMs, anthropicApiKey, anthropicModel });
  } else if (provider === "openrouter") {
    atoms = await atomizeViaOpenRouter(text, { prompt, timeoutMs, openrouterApiKey, openrouterModel });
  } else {
    atoms = await atomizeViaCodex(text, { prompt, timeoutMs });
  }

  if (atoms.length < minAtoms) {
    throw new Error(`atomizeText: got ${atoms.length} atom(s), expected >= ${minAtoms}`);
  }
  return atoms;
}
