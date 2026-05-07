#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

// Load environment variables
const supabaseUrl = 'https://zpeedfgyuusscsrirzsg.supabase.co';
const supabaseServiceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwZWVkZmd5dXVzc2NzcmlyenNnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjM0MDA2MiwiZXhwIjoyMDkxOTE2MDYyfQ.l2xvahChIJ-nXaGAIhpw8I6yNWRskxpkdzweVrucOms';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function applySchema() {
  console.log('Applying enhanced thoughts schema...');

  // First, let's check what columns already exist
  const { data: columns, error: columnsError } = await supabase
    .from('thoughts')
    .select('*')
    .limit(1)
    .single();

  if (columnsError) {
    console.error('Error accessing thoughts table:', columnsError.message);
    return;
  }

  console.log('Existing columns:', Object.keys(columns || {}));

  // Check each column we need
  const neededColumns = ['type', 'source_type', 'sensitivity_tier', 'importance', 'quality_score', 'enriched', 'metadata'];
  const missingColumns = neededColumns.filter(col => !(columns && col in columns));

  console.log('Missing columns:', missingColumns);

  if (missingColumns.length > 0) {
    console.log('Applying schema changes...');

    // Use direct REST API call for SQL
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceRoleKey,
        'Authorization': `Bearer ${supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        sql: `
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'thoughts' AND column_name = 'source_type') THEN
              ALTER TABLE thoughts ADD COLUMN source_type TEXT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'thoughts' AND column_name = 'sensitivity_tier') THEN
              ALTER TABLE thoughts ADD COLUMN sensitivity_tier TEXT DEFAULT 'standard';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'thoughts' AND column_name = 'quality_score') THEN
              ALTER TABLE thoughts ADD COLUMN quality_score numeric(5,2) DEFAULT 50;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'thoughts' AND column_name = 'enriched') THEN
              ALTER TABLE thoughts ADD COLUMN enriched boolean DEFAULT false;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'thoughts' AND column_name = 'metadata') THEN
              ALTER TABLE thoughts ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
            END IF;
          END $$;
        `
      })
    });

    const { error } = await supabase.from('rpc_exec_sql').select('*').limit(1);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to apply schema: ${response.status} ${errorText}`);
    }

    if (error) {
      console.error('Error applying schema:', error.message);
      return;
    }

    // Backfill existing data
    console.log('Backfilling existing data...');
    const { error: backfillError } = await supabase.rpc('exec_sql', {
      sql: `
        UPDATE thoughts SET
          type = COALESCE(metadata->>'type', 'reference'),
          source_type = metadata->>'source',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'enriched', false,
            'summary', null,
            'topics', null,
            'tags', null,
            'people', null,
            'action_items', null,
            'confidence', null,
            'importance', COALESCE(importance, 3),
            'detected_source_type', source_type,
            'enrichment_provenance', null
          )
        WHERE type IS NULL OR source_type IS NULL OR metadata IS NULL;
      `
    });

    if (backfillError) {
      console.error('Error backfilling data:', backfillError.message);
      return;
    }
  }

  // Verify the schema was applied
  console.log('Verifying schema...');
  const { data: verifyData, error: verifyError } = await supabase
    .from('thoughts')
    .select('id, type, source_type, metadata, enriched')
    .limit(3);

  if (verifyError) {
    console.error('Error verifying schema:', verifyError.message);
    return;
  }

  console.log('Schema applied successfully!');
  console.log('Sample data:', verifyData);
}

applySchema().catch(console.error);