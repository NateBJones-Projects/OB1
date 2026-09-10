// recipes/brain-health-monitor/monitor/index.ts
//
// The one quiet probe that only pages when something is actually wrong.
//
// Every run:
//   1. Harvests cron→function outcomes (ops_harvest_responses) before pg_net
//      purges its response table.
//   2. Evaluates critical checks — each tolerant of missing optional schema:
//        - cron/function failures in the last 24h (ops_cron_http_failures)
//        - entity-queue poison/stalled items (ops_queue_poison, if installed)
//        - thoughts missing embeddings for >1h (ops_null_embeddings)
//        - missing content fingerprints / duplicate entity-name groups
//          (via lint_hygiene_summary from recipes/editorial-policy/hygiene.sql,
//          if installed — these are structurally prevented on hardened installs,
//          so any occurrence means a guard regressed)
//        - stale backup receipt (opt-in: only if a '_backup_receipt' row exists
//          in ops_alert_state; your backup job should PATCH it on success)
//   3. Pages Slack ONLY for breaches, deduped via ops_alert_state with a 24h
//      per-alert cooldown. Silence = healthy...
//   4. ...except a WEEKLY heartbeat ("all green") so monitor-death is
//      distinguishable from health (dead-man switch).
//   5. Stores a snapshot row in ops_health_snapshots for trends.
//
// Auth: x-brain-key header (or ?key=) matched against MCP_ACCESS_KEY.
// Body flags: {"dry_run":true}         — evaluate but never post/update state
//             {"force_heartbeat":true} — send heartbeat regardless of age
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MCP_ACCESS_KEY,
//               SLACK_BOT_TOKEN, SLACK_CAPTURE_CHANNEL (or SLACK_OPS_CHANNEL)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;
const SLACK_OPS_CHANNEL = Deno.env.get("SLACK_OPS_CHANNEL") ?? SLACK_CAPTURE_CHANNEL;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const PAGE_COOLDOWN_HOURS = 24;
const HEARTBEAT_DAYS = 7;
const HEARTBEAT_KEY = "_heartbeat";
const BACKUP_RECEIPT_KEY = "_backup_receipt";
const BACKUP_STALE_HOURS = 36;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Breach {
  key: string;
  summary: string; // one Slack line
  details: Record<string, unknown>;
}

async function postToSlack(text: string): Promise<void> {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: SLACK_OPS_CHANNEL, text, unfurl_links: false }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`Slack post failed: ${d.error}`);
}

/** Tolerant table/view read: missing relation → null (check skipped), not a crash. */
async function trySelect<T>(rel: string, cols: string): Promise<T[] | null> {
  const { data, error } = await supabase.from(rel).select(cols);
  if (error) {
    console.warn(`${rel} unavailable (check skipped): ${error.message}`);
    return null;
  }
  return (data ?? []) as T[];
}

async function shouldPage(key: string): Promise<boolean> {
  const { data } = await supabase
    .from("ops_alert_state").select("last_paged_at").eq("alert_key", key).maybeSingle();
  if (!data?.last_paged_at) return true;
  return Date.now() - new Date(data.last_paged_at).getTime() > PAGE_COOLDOWN_HOURS * 3600_000;
}

async function recordAlert(key: string, details: Record<string, unknown>, paged: boolean) {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("ops_alert_state").select("alert_key").eq("alert_key", key).maybeSingle();
  if (data) {
    const patch: Record<string, unknown> = { last_seen: now, details };
    if (paged) patch.last_paged_at = now;
    await supabase.from("ops_alert_state").update(patch).eq("alert_key", key);
  } else {
    await supabase.from("ops_alert_state").insert({
      alert_key: key, details, last_paged_at: paged ? now : null,
    });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const key = req.headers.get("x-brain-key") ?? new URL(req.url).searchParams.get("key");
    if (!MCP_ACCESS_KEY || key !== MCP_ACCESS_KEY) {
      return new Response("unauthorized", { status: 401 });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun: boolean = body.dry_run ?? false;
    const forceHeartbeat: boolean = body.force_heartbeat ?? false;

    // 1. Harvest cron→function outcomes before pg_net purges them.
    const { data: harvested, error: harvestErr } = await supabase.rpc("ops_harvest_responses");
    if (harvestErr) console.warn("harvest failed:", harvestErr.message);

    // 2. Gather check inputs (each tolerant of missing optional schema).
    const [cronFails, poison, nullEmbeds, hygieneRes] = await Promise.all([
      trySelectCronFailures(),
      trySelect<Record<string, unknown>>("ops_queue_poison", "thought_id,status,attempt_count,last_error"),
      trySelect<{ id: string; created_at: string; source: string | null }>(
        "ops_null_embeddings", "id,created_at,source"),
      supabase.rpc("lint_hygiene_summary"),
    ]);
    const hygiene = (hygieneRes.error ? null : hygieneRes.data) as Record<string, number> | null;
    if (hygieneRes.error) {
      console.warn("lint_hygiene_summary unavailable (install editorial-policy hygiene.sql to enable):",
        hygieneRes.error.message);
    }

    const breaches: Breach[] = [];

    for (const f of cronFails ?? []) {
      breaches.push({
        key: `cron_failure:${f.jobname}`,
        summary: `cron *${f.jobname}* → ${f.failure} (${String(f.response_preview ?? "").slice(0, 80)})`,
        details: f as Record<string, unknown>,
      });
    }

    if (poison && poison.length > 0) {
      breaches.push({
        key: "queue_poison",
        summary: `entity queue: ${poison.length} failed/stalled item(s) — first error: ${String(poison[0].last_error ?? "").slice(0, 80)}`,
        details: { count: poison.length, sample: poison.slice(0, 3) },
      });
    }

    // NULL embeddings: only rows older than 1h breach (in-flight writes tolerated).
    const staleNullEmbeds = (nullEmbeds ?? []).filter(
      (r) => Date.now() - new Date(r.created_at).getTime() > 3600_000,
    );
    if (staleNullEmbeds.length > 0) {
      breaches.push({
        key: "null_embeddings",
        summary: `${staleNullEmbeds.length} thought(s) missing embeddings for >1h (write-path leak?) — sources: ${[...new Set(staleNullEmbeds.map((r) => r.source ?? "unknown"))].join(", ")}`,
        details: { count: staleNullEmbeds.length, ids: staleNullEmbeds.slice(0, 5).map((r) => r.id) },
      });
    }

    // Structurally-prevented conditions (write-time trigger / entity dedup):
    // any occurrence means a guard regressed. Only checked when the hygiene
    // summary is installed AND reports the key.
    if (hygiene && (hygiene.missing_fingerprint ?? 0) > 0) {
      breaches.push({
        key: "missing_fingerprints",
        summary: `${hygiene.missing_fingerprint} thought(s) missing content_fingerprint — the write-time trigger may have regressed`,
        details: { count: hygiene.missing_fingerprint },
      });
    }
    if (hygiene && (hygiene.entity_dup_groups ?? 0) > 0) {
      breaches.push({
        key: "entity_dup_groups",
        summary: `${hygiene.entity_dup_groups} duplicate entity-name group(s) — entity dedup may have regressed`,
        details: { count: hygiene.entity_dup_groups },
      });
    }

    // Backup staleness — OPT-IN: only checked when a '_backup_receipt' row
    // exists (seed it when you set up a scheduled backup that PATCHes it).
    const { data: receipt } = await supabase
      .from("ops_alert_state").select("last_paged_at")
      .eq("alert_key", BACKUP_RECEIPT_KEY).maybeSingle();
    if (receipt) {
      const ageH = receipt.last_paged_at
        ? (Date.now() - new Date(receipt.last_paged_at).getTime()) / 3600_000
        : Infinity;
      if (ageH > BACKUP_STALE_HOURS) {
        breaches.push({
          key: "backup_stale",
          summary: `backup receipt is ${ageH === Infinity ? "empty" : Math.round(ageH) + "h old"} (>${BACKUP_STALE_HOURS}h) — check your scheduled backup`,
          details: { receipt_age_hours: ageH === Infinity ? null : Math.round(ageH) },
        });
      }
    }

    // 3. Page breaches (deduped by cooldown).
    const paged: string[] = [];
    for (const b of breaches) {
      const page = !dryRun && (await shouldPage(b.key));
      if (page) {
        await postToSlack(`:rotating_light: *brain-health:* ${b.summary}`);
        paged.push(b.key);
      }
      if (!dryRun) await recordAlert(b.key, b.details, page);
    }

    // 4. Weekly heartbeat when healthy (dead-man switch).
    let heartbeatSent = false;
    if (breaches.length === 0 && !dryRun) {
      const due = forceHeartbeat || (await (async () => {
        const { data } = await supabase
          .from("ops_alert_state").select("last_paged_at")
          .eq("alert_key", HEARTBEAT_KEY).maybeSingle();
        if (!data?.last_paged_at) return true;
        return Date.now() - new Date(data.last_paged_at).getTime() > HEARTBEAT_DAYS * 86400_000;
      })());
      if (due) {
        await postToSlack(
          `:stethoscope: *brain-health:* all green — ${hygiene?.total_thoughts ?? "?"} thoughts, ` +
          `0 cron failures (24h), queue clean, embeddings complete. Next heartbeat in ~${HEARTBEAT_DAYS}d; ` +
          `silence in between means healthy, a page means look.`,
        );
        await recordAlert(HEARTBEAT_KEY, { note: "weekly all-green heartbeat" }, true);
        heartbeatSent = true;
      }
    }

    // 5. Snapshot for trends.
    const snapshot = {
      harvested: harvested ?? 0,
      breach_count: breaches.length,
      breach_keys: breaches.map((b) => b.key),
      cron_failures_24h: (cronFails ?? []).length,
      queue_poison: (poison ?? []).length,
      null_embeddings_stale: staleNullEmbeds.length,
      hygiene,
    };
    if (!dryRun) await supabase.from("ops_health_snapshots").insert({ snapshot });

    return new Response(
      JSON.stringify({
        ok: true, dry_run: dryRun,
        breaches: breaches.map((b) => b.summary),
        paged, heartbeat_sent: heartbeatSent, snapshot,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("brain-health-monitor error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

/** ops_cron_http_failures with typed rows; missing view → null. */
async function trySelectCronFailures(): Promise<
  Array<{ jobname: string; failure: string; invoked_at: string; response_preview: string | null }> | null
> {
  const { data, error } = await supabase
    .from("ops_cron_http_failures")
    .select("jobname,failure,invoked_at,response_preview");
  if (error) {
    console.warn(`ops_cron_http_failures unavailable (install schema.sql): ${error.message}`);
    return null;
  }
  return (data ?? []) as Array<{ jobname: string; failure: string; invoked_at: string; response_preview: string | null }>;
}
