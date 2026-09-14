/**
 * triage.mjs — sensitivity triage for Plaud recordings.
 *
 * Design rules (from OB1's ingestion metadata contract: "if sensitivity is
 * uncertain, escalate rather than downgrade"):
 *
 *   1. First match wins. Rules are evaluated in the order they appear in the
 *      rules file, so the file itself is the audit trail.
 *   2. An explicit `--tier-map` CSV row beats every rule — it is a human
 *      decision, and it is the only thing allowed to lower a tier.
 *   3. Anything unclassified lands on `personal`, never `standard`.
 *   4. A `standard` verdict is re-checked against the restricted/personal regex
 *      sets before it is accepted, so mis-ordering the rules file cannot
 *      quietly downgrade a recording that contains an SSN.
 *   5. The rule that fired is written to `metadata.triage.rule`, so a wrong
 *      call can be found and re-tiered later with one SQL statement.
 *
 * Per-recording modes:
 *   full     — parent thought + LLM-extracted transcript atoms (default)
 *   summary  — parent thought only; the transcript is never sent to an LLM
 *   skip     — nothing is imported
 */

import fs from "node:fs";

export const TIERS = ["standard", "personal", "restricted"];
export const MODES = ["full", "summary", "skip"];

export function tierRank(tier) {
  const index = TIERS.indexOf(tier);
  return index === -1 ? 1 : index; // unknown tiers are treated as 'personal'
}

export function maxTier(a, b) {
  return tierRank(a) >= tierRank(b) ? a : b;
}

// ── Rules loading ────────────────────────────────────────────────────────────

function compileRegexSet(defs, setName) {
  if (!Array.isArray(defs)) return [];
  return defs.map((d, i) => {
    if (!d || typeof d.pattern !== "string") {
      throw new Error(`triage rules: regex.${setName}[${i}] needs a "pattern" string`);
    }
    return { regex: new RegExp(d.pattern, d.flags || ""), label: d.label || `${setName}_${i}` };
  });
}

/**
 * @param {string} filePath path to a triage rules JSON file
 * @returns compiled rules
 */
export function loadTriageRules(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Could not read triage rules at ${filePath}: ${err.message}`);
  }

  const regex = {
    restricted: compileRegexSet(parsed.regex?.restricted, "restricted"),
    personal: compileRegexSet(parsed.regex?.personal, "personal"),
  };

  const rules = (parsed.rules || []).map((rule, i) => {
    const where = `triage rules: rules[${i}]${rule?.name ? ` (${rule.name})` : ""}`;
    if (!rule || typeof rule !== "object") throw new Error(`${where} must be an object`);
    if (!TIERS.includes(rule.tier)) {
      throw new Error(`${where} has tier "${rule.tier}"; expected one of ${TIERS.join(", ")}`);
    }
    if (rule.mode !== undefined && !MODES.includes(rule.mode)) {
      throw new Error(`${where} has mode "${rule.mode}"; expected one of ${MODES.join(", ")}`);
    }
    const kind = rule.kind || (rule.keywords ? "keyword" : "regex");
    if (kind === "keyword") {
      const keywords = (rule.keywords || []).filter((k) => typeof k === "string" && k.trim());
      if (keywords.length === 0) throw new Error(`${where} is a keyword rule with no keywords`);
      return {
        name: rule.name || `rule_${i}`,
        kind,
        tier: rule.tier,
        mode: rule.mode,
        // Word-boundary match so "tax" does not fire on "syntax".
        matchers: keywords.map((k) => ({
          label: k,
          regex: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(k)}([^\\p{L}\\p{N}]|$)`, "iu"),
        })),
      };
    }
    if (kind === "regex") {
      const set = rule.set || "restricted";
      if (!regex[set]) throw new Error(`${where} references unknown regex set "${set}"`);
      return { name: rule.name || `rule_${i}`, kind, tier: rule.tier, mode: rule.mode, set };
    }
    throw new Error(`${where} has unknown kind "${kind}"; expected "keyword" or "regex"`);
  });

  const defaultTier = parsed.default_tier || "personal";
  if (!TIERS.includes(defaultTier)) {
    throw new Error(`triage rules: default_tier "${defaultTier}" is not one of ${TIERS.join(", ")}`);
  }
  if (defaultTier === "standard") {
    throw new Error(
      'triage rules: default_tier must not be "standard" — unclassified material escalates ' +
        '(use "personal" or "restricted").',
    );
  }

  return { version: parsed.version || 1, defaultTier, defaultMode: parsed.default_mode || "full", regex, rules };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Tier map CSV ─────────────────────────────────────────────────────────────

/**
 * Parse a `recording_id,tier,mode` CSV. A header row is optional.
 * @returns {Map<string,{tier:string, mode?:string}>}
 */
export function loadTierMap(filePath) {
  const map = new Map();
  const raw = fs.readFileSync(filePath, "utf8");
  let lineNumber = 0;
  for (const rawLine of raw.split("\n")) {
    lineNumber++;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells[0].toLowerCase() === "recording_id") continue; // header
    const [id, tier, mode] = cells;
    if (!id) continue;
    if (tier && !TIERS.includes(tier)) {
      throw new Error(`${filePath}:${lineNumber}: tier "${tier}" is not one of ${TIERS.join(", ")}`);
    }
    if (mode && !MODES.includes(mode)) {
      throw new Error(`${filePath}:${lineNumber}: mode "${mode}" is not one of ${MODES.join(", ")}`);
    }
    map.set(id, { tier: tier || undefined, mode: mode || undefined });
  }
  return map;
}

// ── Scanning ─────────────────────────────────────────────────────────────────

export function scanRegexSet(text, compiledSet) {
  for (const { regex, label } of compiledSet) {
    // Reset lastIndex in case a caller supplied a /g pattern.
    regex.lastIndex = 0;
    if (regex.test(text)) return label;
  }
  return null;
}

function matchKeywordRule(text, rule) {
  for (const matcher of rule.matchers) {
    if (matcher.regex.test(text)) return matcher.label;
  }
  return null;
}

/**
 * Build the text the rules are evaluated against: title, speakers, summary,
 * highlights, and the first `transcriptWords` words of the transcript.
 * Scanning the whole transcript would be slower and no more accurate — the
 * regex escalation pass below covers the rest of the body at insert time.
 */
export function triageText(record, transcriptWords = 2000) {
  const head = record.transcript
    ? record.transcript.split(/\s+/).slice(0, transcriptWords).join(" ")
    : "";
  const tags = []
    .concat(record.raw_meta?.tags || [])
    .concat(record.raw_meta?.folder || [])
    .concat(record.raw_meta?.labels || [])
    .filter((t) => typeof t === "string");
  return [record.title, record.speakers.join(" "), tags.join(" "), record.summary, record.highlights, head]
    .filter(Boolean)
    .join("\n");
}

/**
 * Decide the tier and mode for one recording.
 *
 * @returns {{tier:string, mode:string, rule:string, label:string|null, tier_source:string}}
 */
export function triageRecording(record, options = {}) {
  const {
    rules,
    tierMap = null,
    restrictedMode = "summary",
    transcriptWords = 2000,
  } = options;

  const text = triageText(record, transcriptWords);

  // 1. Explicit map wins over everything — including the escalation guard.
  const override = tierMap?.get(record.recording_id);
  if (override && (override.tier || override.mode)) {
    const tier = override.tier || resolveByRules(text, rules).tier;
    return {
      tier,
      mode: override.mode || defaultModeFor(tier, rules, restrictedMode),
      rule: "tier-map",
      label: null,
      tier_source: "map",
    };
  }

  const verdict = resolveByRules(text, rules);

  // 4. Escalation guard: never accept `standard` without a full regex sweep.
  if (verdict.tier === "standard") {
    const restrictedHit = scanRegexSet(text, rules.regex.restricted);
    if (restrictedHit) {
      return {
        tier: "restricted",
        mode: defaultModeFor("restricted", rules, restrictedMode),
        rule: `escalation:regex:restricted`,
        label: restrictedHit,
        tier_source: "regex",
      };
    }
    const personalHit = scanRegexSet(text, rules.regex.personal);
    if (personalHit) {
      return {
        tier: "personal",
        mode: defaultModeFor("personal", rules, restrictedMode),
        rule: `escalation:regex:personal`,
        label: personalHit,
        tier_source: "regex",
      };
    }
  }

  return {
    tier: verdict.tier,
    mode: verdict.mode || defaultModeFor(verdict.tier, rules, restrictedMode),
    rule: verdict.rule,
    label: verdict.label,
    tier_source: verdict.tier_source,
  };
}

function resolveByRules(text, rules) {
  for (const rule of rules.rules) {
    if (rule.kind === "regex") {
      const hit = scanRegexSet(text, rules.regex[rule.set]);
      if (hit) {
        return {
          tier: rule.tier,
          mode: rule.mode,
          rule: `regex:${rule.name}`,
          label: hit,
          tier_source: "regex",
        };
      }
      continue;
    }
    const hit = matchKeywordRule(text, rule);
    if (hit) {
      return {
        tier: rule.tier,
        mode: rule.mode,
        rule: `keyword:${rule.name}`,
        label: hit,
        tier_source: "triage",
      };
    }
  }
  // 3. Unclassified escalates.
  return { tier: rules.defaultTier, mode: undefined, rule: "default:unclassified", label: null, tier_source: "default" };
}

function defaultModeFor(tier, rules, restrictedMode) {
  if (tier === "restricted") return restrictedMode;
  return rules.defaultMode || "full";
}
