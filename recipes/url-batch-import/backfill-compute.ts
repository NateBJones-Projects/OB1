#!/usr/bin/env -S deno run --allow-read
/**
 * Backfill helper — reads a JSON file of [{ id, url }] rows and prints
 * [{ id, fingerprint }] using the SAME urlFingerprint() the importer uses,
 * guaranteeing migrated fingerprints match future imports exactly.
 *
 * Usage: deno run --allow-read backfill-compute.ts --input=rows.json > out.json
 */
import { urlFingerprint } from "./import-urls.ts";

const inputArg = Deno.args.find((a) => a.startsWith("--input="));
if (!inputArg) {
  console.error("Usage: deno run --allow-read backfill-compute.ts --input=rows.json");
  Deno.exit(1);
}
const path = inputArg.split("=").slice(1).join("=");
const rows: Array<{ id: string; url: string | null }> = JSON.parse(
  await Deno.readTextFile(path),
);

const out: Array<{ id: string; fingerprint: string | null }> = [];
for (const r of rows) {
  out.push({
    id: r.id,
    fingerprint: r.url ? await urlFingerprint(r.url) : null,
  });
}
console.log(JSON.stringify(out));
