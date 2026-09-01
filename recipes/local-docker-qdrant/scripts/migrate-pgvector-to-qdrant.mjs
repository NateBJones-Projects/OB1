#!/usr/bin/env node
// migrate-pgvector-to-qdrant.mjs
// Migrates thoughts from local pgvector (Open Brain local-docker recipe) to Qdrant (this recipe).
//
// Prerequisites: Node 18+, access to both stacks.
// Install postgres package first: npm install postgres
//
// Usage:
//   node migrate-pgvector-to-qdrant.mjs \
//     --pg-url postgres://openbrain:password@localhost:5432/openbrain \
//     --qdrant-url http://localhost:6333 \
//     --dry-run
//
// Use --dry-run first to verify counts without writing anything.
// The script is idempotent: re-running it upserts existing points by UUID.

// Run: npm install postgres  (one-time, in the scripts/ directory or anywhere on the path)

import postgres from "postgres";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    pgUrl: null,
    qdrantUrl: "http://localhost:6333",
    ownerId: "local-user",
    visibility: "private",
    dryRun: false,
    batchSize: 100,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--pg-url":
        result.pgUrl = next;
        i++;
        break;
      case "--qdrant-url":
        result.qdrantUrl = next;
        i++;
        break;
      case "--owner-id":
        result.ownerId = next;
        i++;
        break;
      case "--visibility":
        result.visibility = next;
        i++;
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--batch-size":
        result.batchSize = parseInt(next, 10);
        i++;
        break;
      default:
        if (arg.startsWith("--")) {
          console.warn(`Warning: unknown argument "${arg}"`);
        }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = parseArgs(process.argv);

  if (!config.pgUrl) {
    console.error("Error: --pg-url is required.");
    console.error(
      "Example: node migrate-pgvector-to-qdrant.mjs --pg-url postgres://openbrain:password@localhost:5432/openbrain"
    );
    process.exit(1);
  }

  if (isNaN(config.batchSize) || config.batchSize < 1) {
    console.error("Error: --batch-size must be a positive integer.");
    process.exit(1);
  }

  // Print configuration summary
  console.log("=== pgvector → Qdrant Migration ===");
  console.log(`  pg-url:     ${config.pgUrl.replace(/:\/\/[^@]+@/, "://<redacted>@")}`);
  console.log(`  qdrant-url: ${config.qdrantUrl}`);
  console.log(`  owner-id:   ${config.ownerId}`);
  console.log(`  visibility: ${config.visibility}`);
  console.log(`  batch-size: ${config.batchSize}`);
  console.log(`  dry-run:    ${config.dryRun}`);
  console.log("");

  // ---------------------------------------------------------------------------
  // Connect to pgvector
  // ---------------------------------------------------------------------------
  const sql = postgres(config.pgUrl, { max: 1 });

  let totalCount;
  try {
    const [row] = await sql`SELECT COUNT(*) AS count FROM thoughts WHERE embedding IS NOT NULL`;
    totalCount = parseInt(row.count, 10);
  } catch (err) {
    console.error("Failed to connect to pgvector or query thoughts table:", err.message);
    await sql.end();
    process.exit(1);
  }

  console.log(`Found ${totalCount} thoughts with embeddings to migrate.`);

  if (totalCount === 0) {
    console.log("Nothing to migrate. Exiting.");
    await sql.end();
    process.exit(0);
  }

  const totalBatches = Math.ceil(totalCount / config.batchSize);

  let written = 0;
  let errors = 0;
  let offset = 0;
  let batchIndex = 0;

  // ---------------------------------------------------------------------------
  // Batch scroll + upsert
  // ---------------------------------------------------------------------------
  while (offset < totalCount) {
    batchIndex++;

    const rows = await sql`
      SELECT id, content, metadata, embedding::text AS embedding, created_at
      FROM thoughts
      WHERE embedding IS NOT NULL
      ORDER BY created_at ASC
      LIMIT ${config.batchSize} OFFSET ${offset}
    `;

    if (rows.length === 0) {
      break;
    }

    if (config.dryRun) {
      // Print first 3, then count the rest
      const preview = rows.slice(0, 3);
      for (const row of preview) {
        const snippet = row.content.substring(0, 60).replace(/\n/g, " ");
        console.log(`  Would migrate: ${row.id} — ${snippet}`);
      }
      if (rows.length > 3) {
        console.log(`  ... and ${rows.length - 3} more in this batch.`);
      }
      written += rows.length;
    } else {
      // Build Qdrant points
      const batchPoints = rows.map((row) => {
        const meta = row.metadata ?? {};

        // Parse embedding from pgvector text representation "[0.1,0.2,...]"
        let vector;
        try {
          vector = JSON.parse(row.embedding);
        } catch (parseErr) {
          throw new Error(`Failed to parse embedding for row ${row.id}: ${parseErr.message}`);
        }

        const payload = {
          content: row.content,
          type: meta.type ?? "observation",
          topics: meta.topics ?? [],
          people: meta.people ?? [],
          actions: meta.action_items ?? [],
          source: meta.source ?? "migration",
          owner_id: config.ownerId,
          owner_email: "local@localhost",
          visibility: config.visibility,
          shared_with: [],
          created_at: row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        };

        // Optional fields — only include if present in metadata
        if (meta.title !== undefined) payload.title = meta.title;
        if (meta.url !== undefined) payload.url = meta.url;

        return { id: row.id, vector, payload };
      });

      // Upsert to Qdrant
      try {
        const resp = await fetch(
          `${config.qdrantUrl}/collections/thoughts/points?wait=true`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ points: batchPoints }),
          }
        );

        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${body}`);
        }

        written += batchPoints.length;
      } catch (err) {
        console.error(
          `  ERROR on batch ${batchIndex}/${totalBatches}: ${err.message}`
        );
        errors += rows.length;
      }
    }

    console.log(
      `Batch ${batchIndex}/${totalBatches}: migrated ${written} / ${totalCount} (errors: ${errors})`
    );

    offset += rows.length;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  await sql.end();

  const skipped = totalCount - written - errors;

  if (config.dryRun) {
    console.log("");
    console.log(
      `Dry-run complete: ${written} thoughts would be written (${errors} errors, ${skipped} skipped).`
    );
    console.log("Re-run without --dry-run to perform the actual migration.");
  } else {
    console.log("");
    console.log(
      `Migration complete: ${written} written, ${errors} errors, ${skipped} skipped (no embedding).`
    );
  }

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
