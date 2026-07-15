// enrichment-worker — drains thoughts_needing_enrichment through the
// canonical extractMetadata cascade and writes metadata back in place.
//
// Params: ?limit=1..25 (default 20) | ?id=<uuid> single-row fast path
// Auth:   x-brain-key header, Authorization bearer, or ?key= (MCP_ACCESS_KEY)
//
// Circuit breaker: if the first min(5, claimed) rows ALL come back
// fallback — or ANY row returns a run-level error (budget/no provider) —
// the tick aborts, clears every unwritten claim, and consumes zero row
// attempts for those rows. A provider outage must never strand rows at
// max attempts.
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractMetadata, embedText } from "./_shared/helpers.ts";
import {
  buildCompletePatch,
  buildFallbackPatch,
  buildClaimClearPatch,
  RUN_LEVEL_ERRORS,
  type ClaimedRow,
  type Extracted,
} from "./merge.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const CIRCUIT_PROBE = 5;

function authorized(req: Request, url: URL): boolean {
  if (!MCP_ACCESS_KEY) return false;
  const header = req.headers.get("x-brain-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return header === MCP_ACCESS_KEY || url.searchParams.get("key") === MCP_ACCESS_KEY;
}

async function writePatch(
  id: string,
  patch: { type?: string; metadata: Record<string, unknown> },
  embedding?: number[],
): Promise<void> {
  const update: Record<string, unknown> = { metadata: patch.metadata };
  if (patch.type) update.type = patch.type;
  if (embedding) update.embedding = embedding;
  const { error } = await supabase.from("thoughts").update(update).eq("id", id);
  if (error) throw new Error(`write failed for ${id}: ${error.message}`);
}

async function clearClaims(rows: ClaimedRow[]): Promise<void> {
  for (const row of rows) {
    try {
      await writePatch(row.id, buildClaimClearPatch(row));
    } catch (err) {
      // Lease expires in 10 min anyway; log and continue.
      console.error("claim clear failed", row.id, err);
    }
  }
}

async function remainingCount(): Promise<number> {
  const { count } = await supabase
    .from("thoughts_needing_enrichment")
    .select("id", { count: "exact", head: true });
  return count ?? -1;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (!authorized(req, url)) {
    return new Response("unauthorized", { status: 401 });
  }

  const runId = crypto.randomUUID();
  const idParam = url.searchParams.get("id");
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 20, 25));

  const { data, error } = await supabase.rpc("claim_thoughts_for_enrichment", {
    p_batch: idParam ? 1 : limit,
    p_id: idParam,
  });
  if (error) {
    console.error(JSON.stringify({ run_id: runId, claim_error: error.message }));
    return new Response(JSON.stringify({ run_id: runId, error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const rows = (data ?? []) as ClaimedRow[];
  let enriched = 0;
  let fallback = 0;
  let circuitBroken = false;

  // Rows whose patch (enriched OR fallback) has actually been written to the
  // DB. This Set is the single source of truth for claim bookkeeping: a claim
  // must be cleared for exactly the rows that were claimed but never written.
  // Rows already written removed the claim key via their own patch, so they
  // must NOT be claim-cleared.
  const writtenIds = new Set<string>();

  // Buffer the first CIRCUIT_PROBE results; only flush once we know the
  // providers are actually up. A run-level error breaks immediately.
  const buffered: Array<{ row: ClaimedRow; extracted: Extracted }> = [];
  let flushed = false;

  const applyResult = async (row: ClaimedRow, extracted: Extracted) => {
    if (extracted._enrichment_status === "complete") {
      const patch = buildCompletePatch(row, extracted);
      const embedding = row.needs_embedding
        ? await embedText(row.content)
        : undefined;
      await writePatch(row.id, patch, embedding);
      enriched++;
    } else {
      await writePatch(
        row.id,
        buildFallbackPatch(row, extracted._enrichment_error ?? "unknown"),
      );
      fallback++;
    }
    writtenIds.add(row.id);
  };

  const flush = async () => {
    for (const { row, extracted } of buffered) {
      await applyResult(row, extracted);
    }
    buffered.length = 0;
    flushed = true;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const extracted = await extractMetadata(row.content);

    if (extracted._enrichment_error &&
        RUN_LEVEL_ERRORS.has(extracted._enrichment_error)) {
      circuitBroken = true;
      break;
    }

    if (!flushed) {
      buffered.push({ row, extracted });
      const probeSize = Math.min(CIRCUIT_PROBE, rows.length);
      if (buffered.length >= probeSize) {
        const allFallback = buffered.every(
          (b) => b.extracted._enrichment_status === "fallback",
        );
        // A single fallback proves nothing; only break when the whole probe
        // came back fallback AND there was more than one row to judge on.
        if (allFallback && rows.length > 1) {
          circuitBroken = true;
          break;
        }
        await flush();
      }
    } else {
      await applyResult(row, extracted);
    }
  }

  if (circuitBroken) {
    // Clear claims for exactly the rows that were claimed but never written:
    // everything still buffered (never flushed) plus the unprocessed tail.
    // Rows in writtenIds already dropped the claim key via their own patch,
    // so they are intentionally excluded. enriched/fallback are left as-is —
    // if the break happened after a flush, those counts are real writes and
    // the response must report them, not zero them out.
    await clearClaims(rows.filter((r) => !writtenIds.has(r.id)));
  } else if (!flushed) {
    await flush(); // batches smaller than the probe size, or empty batch
  }

  const remaining = await remainingCount();
  const summary = {
    run_id: runId,
    claimed: rows.length,
    enriched,
    fallback,
    circuit_broken: circuitBroken,
    remaining,
  };
  console.log(JSON.stringify(summary));
  return new Response(JSON.stringify(summary), {
    headers: { "Content-Type": "application/json" },
  });
});
