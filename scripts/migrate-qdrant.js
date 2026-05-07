#!/usr/bin/env node

/**
 * Migrate Qdrant documents → Supabase via REST API
 *
 * Usage: node migrate-qdrant.js
 *
 * Reads from qdrant.billgleeson.com, POSTs to open-brain-rest /capture
 */

const QDRANT_URL = 'https://qdrant.billgleeson.com';
const REST_API_URL = 'https://zpeedfgyuusscsrirzsg.supabase.co/functions/v1/open-brain-rest';
const API_KEY = 'c5061efb5c64a3e54aa4d340effd8f446d48d0921b683cef97c771dcf496a672';
const COLLECTION = 'documents';
const BATCH_SIZE = 50;
const DELAY_MS = 200; // Rate limit between batches

async function scrollPoints(cursor = null) {
  const body = { limit: BATCH_SIZE, with_payload: true, with_vector: false };
  if (cursor) body.offset = cursor;

  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Qdrant scroll failed: ${res.status}`);
  return await res.json();
}

async function captureThought(content, metadata) {
  const res = await fetch(`${REST_API_URL}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-brain-key': API_KEY,
    },
    body: JSON.stringify({ content, metadata }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Capture failed: ${res.status} ${text}`);
  }
  return await res.json();
}

async function main() {
  console.log('Qdrant → Supabase Migration');
  console.log('===========================\n');

  // Check Qdrant
  const collRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`);
  if (!collRes.ok) {
    console.error(`Cannot reach Qdrant collection: ${collRes.status}`);
    process.exit(1);
  }
  const collInfo = await collRes.json();
  const totalPoints = collInfo.result.points_count;
  console.log(`Found ${totalPoints} points in '${COLLECTION}'`);

  let cursor = null;
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  do {
    const data = await scrollPoints(cursor);
    const points = data.result?.points || [];

    for (const point of points) {
      const payload = point.payload || {};
      const content = payload.content;

      if (!content || content.trim().length === 0) {
        skipped++;
        continue;
      }

      // Build metadata from payload (everything except content)
      const metadata = {};
      for (const [key, value] of Object.entries(payload)) {
        if (key !== 'content') {
          metadata[key] = value;
        }
      }
      // Mark as migrated
      metadata.migrated_from = 'qdrant';
      metadata.qdrant_id = String(point.id);

      try {
        await captureThought(content, metadata);
        migrated++;
        if (migrated % 50 === 0) {
          console.log(`  Migrated ${migrated}/${totalPoints}...`);
        }
      } catch (err) {
        // Likely a duplicate (content_fingerprint conflict) - skip
        if (err.message.includes('duplicate') || err.message.includes('fingerprint')) {
          skipped++;
        } else {
          errors++;
          console.error(`  Error on point ${point.id}: ${err.message}`);
        }
      }

      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 100));
    }

    cursor = data.result?.next_page_offset;
  } while (cursor);

  console.log(`\nMigration Complete!`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
}

main().catch(console.error);
