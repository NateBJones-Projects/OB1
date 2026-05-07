#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

// Load environment variables
const supabaseUrl = 'https://zpeedfgyuusscsrirzsg.supabase.co';
const supabaseServiceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwZWVkZmd5dXVzc2NzcmlyenNnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjM0MDA2MiwiZXhwIjoyMDkxOTE2MDYyfQ.l2xvahChIJ-nXaGAIhpw8I6yNWRskxpkdzweVrucOms';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function applySchema() {
  console.log('Applying enhanced thoughts schema...');

  try {
    // Create the function first
    const { data: funcData, error: funcError } = await supabase
      .from('rpc_exec_sql')
      .select('*')
      .limit(1);

    if (funcError && funcError.message.includes('relation')) {
      console.log('Need to create exec_sql function first');

      // Try to create the function using direct SQL
      const createFunctionSql = `
        CREATE OR REPLACE FUNCTION public.exec_sql(sql TEXT)
        RETURNS TABLE(result JSONB)
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
          RETURN QUERY EXECUTE sql;
          RETURN;
        END;
        $$;
      `;

      // This is a complex scenario - let's try a different approach
      // Let's manually patch the table using the update method
    }

    // Check which columns are missing
    const { data: sample, error: sampleError } = await supabase
      .from('thoughts')
      .select('*')
      .limit(1)
      .single();

    if (sampleError) {
      console.error('Error getting sample:', sampleError.message);
      return;
    }

    console.log('Existing columns:', Object.keys(sample));

    // Try to add columns one by one using UPDATE
    const updates = [];

    if (!sample.source_type) {
      updates.push('ALTER TABLE thoughts ADD COLUMN source_type TEXT');
    }
    if (!sample.sensitivity_tier) {
      updates.push('ALTER TABLE thoughts ADD COLUMN sensitivity_tier TEXT DEFAULT \'standard\'');
    }
    if (!sample.quality_score) {
      updates.push('ALTER TABLE thoughts ADD COLUMN quality_score numeric(5,2) DEFAULT 50');
    }
    if (!sample.enriched) {
      updates.push('ALTER TABLE thoughts ADD COLUMN enriched boolean DEFAULT false');
    }

    if (updates.length > 0) {
      console.log('Need to add columns:', updates);

      // For Supabase, we need to use the database console or migrations
      // Since we can't run ALTER TABLE directly through the REST API for this operation,
      // let's try to work around it

      // First, let's check if we can use the SQL editor in the dashboard
      console.log('\nManual steps required:');
      console.log('1. Go to your Supabase dashboard');
      console.log('2. Navigate to your project');
      console.log('3. Go to the SQL Editor');
      console.log('4. Run the following SQL:');
      updates.forEach(sql => console.log('   ' + sql));
      console.log('5. Then run the backfill query:');
      console.log('   UPDATE thoughts SET');
      console.log('     type = COALESCE(metadata->>\'type\', \'reference\'),');
      console.log('     source_type = metadata->>\'source\',');
      console.log('     metadata = COALESCE(metadata, \'{}\'::jsonb) || jsonb_build_object(');
      console.log('       \'enriched\', false,');
      console.log('       \'summary\', null,');
      console.log('       \'topics\', null,');
      console.log('       \'tags\', null,');
      console.log('       \'people\', null,');
      console.log('       \'action_items\', null,');
      console.log('       \'confidence\', null,');
      console.log('       \'importance\', COALESCE(importance, 3),');
      console.log('       \'detected_source_type\', source_type,');
      console.log('       \'enrichment_provenance\', null');
      console.log('     )');
      console.log('   WHERE type IS NULL OR source_type IS NULL OR metadata IS NULL;');
    } else {
      console.log('All required columns already exist!');
    }

    // Try to create a workaround function
    const { error: createError } = await supabase.rpc('create_extension', {
      extension_name: 'uuid-ossp'
    });

    if (createError && !createError.message.includes('already exists')) {
      console.log('Could not create extension:', createError.message);
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

applySchema().catch(console.error);