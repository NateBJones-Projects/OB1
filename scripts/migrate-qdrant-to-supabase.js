#!/usr/bin/env node

const fs = require('fs').promises;
const crypto = require('crypto');

// Configuration
const QDRANT_URL = 'http://localhost:6333';
const SUPABASE_URL = 'https://zpeedfgyuusscsuirzsg.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1zdGF0ZWMiLCJqdGkiOiJlMjg0ODQ1OC01ZDE0LTQ1NTctOGNkNi1kNmQ3NzlmYTJlN2EiLCJpYXQiOjE3MTY3NTg2NTksImV4cCI6MTcxNjc2OTQ1OX0.XXX'; // Replace with actual anon key
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1zdGF0ZWMiLCJzdWIiOiJlYjU4MzM2NS1iY2Q4LTQ3MTYtODA1My04NjU5NjE0Zjg2NWEiLCJpYXQiOjE3MTY3NTg2NTksImV4cCI6MTcxNjc2OTQ1OX0.XXX'; // Replace with actual service role key
const DEFAULT_USER_ID = '74aa7ac8-b6a3-47da-88e5-6e48cb136aa0';
const BATCH_SIZE = 50;

// Helper function to generate content fingerprint
function generateContentFingerprint(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Helper function to map Qdrant payload to Supabase format
function mapToSupabaseFormat(qdrantPoint) {
  const payload = qdrantPoint.payload || {};
  const vector = qdrantPoint.vector || [];

  // Extract metadata from payload (excluding content and vector)
  const metadata = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== 'content' && !key.startsWith('embedding')) {
      metadata[key] = value;
    }
  }

  return {
    content: payload.content || '',
    embedding: vector,
    metadata: metadata,
    user_id: DEFAULT_USER_ID,
    content_fingerprint: generateContentFingerprint(payload.content || ''),
    created_at: payload.timestamp || new Date().toISOString()
  };
}

// Check if Qdrant is running
async function checkQdrant() {
  try {
    const response = await fetch(`${QDRANT_URL}/collections`);
    if (response.ok) {
      console.log('✓ Qdrant is running');
      return true;
    }
  } catch (error) {
    console.log('✗ Qdrant is not running:', error.message);
    console.log('\nTo start Qdrant, you need to:');
    console.log('1. Install Docker or run Qdrant directly');
    console.log('2. Start Qdrant on localhost:6333');
    console.log('3. Then run this script again');
  }
  return false;
}

// List all collections
async function listCollections() {
  try {
    const response = await fetch(`${QDRANT_URL}/collections`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    return data.result.collections.map(c => c.name);
  } catch (error) {
    console.error('Error listing collections:', error);
    return [];
  }
}

// Scroll through points in a collection
async function scrollCollectionPoints(collectionName, limit = 100, cursor = null) {
  try {
    const url = cursor
      ? `${QDRANT_URL}/collections/${collectionName}/points/scroll?limit=${limit}&cursor=${cursor}`
      : `${QDRANT_URL}/collections/${collectionName}/points/scroll?limit=${limit}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    return await response.json();
  } catch (error) {
    console.error(`Error scrolling points in ${collectionName}:`, error);
    return { result: [], next_page_cursor: null };
  }
}

// Get all points from a collection
async function getAllCollectionPoints(collectionName) {
  console.log(`\n📦 Getting all points from collection: ${collectionName}`);

  let allPoints = [];
  let cursor = null;
  let pageCount = 0;
  let totalPoints = 0;

  do {
    const data = await scrollCollectionPoints(collectionName, BATCH_SIZE, cursor);
    const points = data.result || [];

    if (points.length > 0) {
      allPoints = allPoints.concat(points);
      pageCount++;
      totalPoints += points.length;

      // Progress update
      if (pageCount % 10 === 0) {
        console.log(`   Processed ${totalPoints} points...`);
      }
    }

    cursor = data.next_page_cursor;
  } while (cursor);

  console.log(`   Found ${totalPoints} points in ${pageCount} pages`);
  return allPoints;
}

// Check existing data in Supabase
async function checkExistingData() {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/thoughts?select=id,content_fingerprint&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.length;
    }
    return 0;
  } catch (error) {
    console.error('Error checking existing data:', error);
    return 0;
  }
}

// Insert batch of thoughts into Supabase
async function insertBatchToSupabase(thoughts) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(thoughts.map(t => ({
        content: t.content,
        embedding: t.embedding,
        metadata: t.metadata,
        user_id: t.user_id,
        content_fingerprint: t.content_fingerprint,
        created_at: t.created_at
      })))
    });

    if (response.ok) {
      return await response.json();
    } else {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }
  } catch (error) {
    console.error('Error inserting batch:', error);
    throw error;
  }
}

// Main migration function
async function migrateCollection(collectionName) {
  console.log(`\n🚀 Starting migration of ${collectionName} collection`);

  try {
    // Get all points from collection
    const points = await getAllCollectionPoints(collectionName);

    if (points.length === 0) {
      console.log(`   No points found in ${collectionName}`);
      return 0;
    }

    console.log(`\n📋 Mapping ${points.length} points to Supabase format...`);

    // Map points to Supabase format
    const supabaseThoughts = points
      .filter(point => point.payload && point.payload.content) // Only points with content
      .map(mapToSupabaseFormat);

    console.log(`✓ Mapped ${supabaseThoughts.length} valid thoughts`);

    // Check for duplicates
    const uniqueThoughts = [];
    const seenFingerprints = new Set();

    for (const thought of supabaseThoughts) {
      if (!seenFingerprints.has(thought.content_fingerprint)) {
        uniqueThoughts.push(thought);
        seenFingerprints.add(thought.content_fingerprint);
      } else {
        console.log(`   Skipping duplicate: ${thought.content.substring(0, 50)}...`);
      }
    }

    console.log(`✓ Found ${uniqueThoughts.length} unique thoughts after deduplication`);

    // Insert into Supabase
    console.log('\n📤 Inserting into Supabase...');
    let totalInserted = 0;

    for (let i = 0; i < uniqueThoughts.length; i += BATCH_SIZE) {
      const batch = uniqueThoughts.slice(i, i + BATCH_SIZE);
      console.log(`   Processing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(uniqueThoughts.length/BATCH_SIZE)}...`);

      try {
        await insertBatchToSupabase(batch);
        totalInserted += batch.length;
        console.log(`   ✓ Inserted ${batch.length} records`);
      } catch (error) {
        console.error(`   ✗ Error inserting batch: ${error.message}`);
        // Continue with next batch
      }
    }

    console.log(`\n✅ Migration complete! Inserted ${totalInserted} thoughts from ${collectionName}`);
    return totalInserted;

  } catch (error) {
    console.error(`\n❌ Migration failed for ${collectionName}:`, error.message);
    return 0;
  }
}

// Main execution
async function main() {
  console.log('🔄 Qdrant to Supabase Migration Tool');
  console.log('====================================\n');

  // Check if Qdrant is running
  const qdrantRunning = await checkQdrant();
  if (!qdrantRunning) {
    process.exit(1);
  }

  // Check existing data in Supabase
  console.log('\n📊 Checking existing data in Supabase...');
  const existingCount = await checkExistingData();
  console.log(`Existing thoughts in Supabase: ${existingCount}`);

  // Get collections
  const collections = await listCollections();
  console.log(`\n📚 Found collections: ${collections.join(', ')}`);

  if (collections.length === 0) {
    console.log('No collections found in Qdrant');
    process.exit(0);
  }

  // Process each collection
  let totalMigrated = 0;
  const collectionsToMigrate = collections.filter(name =>
    name.includes('thought') ||
    name.includes('open_brain') ||
    name.includes('document') ||
    name.includes('dok')
  );

  console.log(`\n🎯 Collections to migrate: ${collectionsToMigrate.join(', ')}`);

  for (const collection of collectionsToMigrate) {
    const migrated = await migrateCollection(collection);
    totalMigrated += migrated;
  }

  // Final summary
  console.log('\n🎉 Migration Summary');
  console.log('====================');
  console.log(`Total thoughts migrated: ${totalMigrated}`);
  console.log(`Total thoughts in Supabase: ${existingCount + totalMigrated}`);

  if (totalMigrated > 0) {
    console.log('\n✅ Migration completed successfully!');
  } else {
    console.log('\n⚠️  No data was migrated. Please check the logs above.');
  }
}

// Run the migration
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { migrateCollection, mapToSupabaseFormat };