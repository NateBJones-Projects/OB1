#!/usr/bin/env node
/**
 * enrich-thoughts-final.mjs - Final working version
 */

import { createClient } from '@supabase/supabase-js';

const CLASSIFICATION_PROMPT = [
  "You classify personal notes for a second-brain system.",
  "Return STRICT JSON with keys: type, summary, topics, tags, people, action_items, confidence, importance, detected_source_type.",
  "",
  "type must be one of: idea, task, person_note, reference, decision, lesson, meeting, journal.",
  "summary: max 160 chars, capturing what this thought IS about personally.",
  "topics: 3-5 keywords describing what this thought covers.",
  "tags: 3-7 tags categorizing this thought.",
  "people: array of names mentioned (only if named people appear).",
  "action_items: array of specific actions to take (only if actionable).",
  "confidence: 0.0-1.0 certainty in this classification.",
  "importance: 1-5 scale (5=critical/urgent).",
  "detected_source_type: how this entered the system (chatgpt_import, etc.).",
  "",
  "CLASSIFY:",
].join("\n");

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');
let limit = 0;
  for (const arg of args) {
    if (arg.startsWith('--limit')) {
      const parts = arg.split('=');
      if (parts.length > 1) {
        limit = parseInt(parts[1]);
      } else {
        // Handle --limit 3 (space separated)
        const index = args.indexOf(arg);
        if (index + 1 < args.length && !args[index + 1].startsWith('--')) {
          limit = parseInt(args[index + 1]);
        }
      }
    }
  }

// Load environment
const supabaseUrl = 'https://zpeedfgyuusscsrirzsg.supabase.co';
const supabaseServiceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwZWVkZmd5dXVzc2NzcmlyenNnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjM0MDA2MiwiZXhwIjoyMDkxOTE2MDYyfQ.l2xvahChIJ-nXaGAIhpw8I6yNWRskxpkdzweVrucOms';
const openaiApiKey = 'REDACTED_OPENAI_KEY';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function classifyThought(content) {
  const userInput = content.substring(0, 1500);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      temperature: 0.1,
      messages: [
        { role: 'system', content: CLASSIFICATION_PROMPT },
        { role: 'user', content: userInput },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const result = await response.json();
  const rawResponse = result.choices[0].message.content;

  // Parse JSON
  try {
    return JSON.parse(rawResponse);
  } catch {
    // Try to extract JSON from markdown
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Invalid JSON response');
  }
}

async function enrichThought(thought) {
  console.log(`[${dryRun ? 'DRY' : 'ENRICH'}] ${thought.id}: Processing...`);

  try {
    const classification = await classifyThought(thought.content);

    const updateData = {
      type: classification.type || 'reference',
      metadata: {
        ...thought.metadata,
        summary: classification.summary || thought.content.substring(0, 160),
        topics: classification.topics || [],
        tags: classification.tags || [],
        people: classification.people || [],
        action_items: classification.action_items || [],
        confidence: classification.confidence || 0.8,
        importance: classification.importance || 3,
        detected_source_type: classification.detected_source_type || 'manual',
        enriched_at: new Date().toISOString(),
        enriched_model: 'gpt-4o-mini',
      },
    };

    if (!dryRun) {
      const { error } = await supabase
        .from('thoughts')
        .update(updateData)
        .eq('id', thought.id);

      if (error) {
        console.error(`[ERROR] ${thought.id}: ${error.message}`);
        return false;
      }
    }

    console.log(`[${dryRun ? 'DRY' : 'OK'}] ${thought.id}: ${classification.type} (imp: ${classification.importance || 3})`);
    return true;
  } catch (err) {
    console.error(`[ERROR] ${thought.id}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Limit: ${limit || 'all'}`);
  console.log();

  let processed = 0;
  let enriched = 0;
  let lastId = '';

  while (true) {
    // Check if we've reached the limit
    if (limit > 0 && processed >= limit) {
      console.log(`\nReached limit of ${limit} thoughts`);
      break;
    }

    // Calculate remaining to fetch
    const fetchLimit = limit > 0 ? Math.min(limit - processed, 5) : 5;

    let query = supabase
      .from('thoughts')
      .select('id, content')
      .order('id', { ascending: true })
      .limit(fetchLimit);

    if (lastId) {
      query = query.gt('id', lastId);
    }

    const { data: thoughts, error } = await query;

    if (error || !thoughts || thoughts.length === 0) {
      console.log('\nNo more thoughts to process');
      break;
    }

    console.log(`Fetched ${thoughts.length} thoughts (total processed: ${processed + thoughts.length})`);

    // Process each thought
    for (const thought of thoughts) {
      if (limit > 0 && processed >= limit) break;

      const success = await enrichThought(thought);
      if (success) enriched++;

      processed++;
      lastId = thought.id;

      if (processed % 5 === 0) {
        console.log(`Progress: ${processed} processed, ${enriched} enriched`);
      }
    }
  }

  console.log('\n=== COMPLETE ===');
  console.log(`Processed: ${processed}`);
  console.log(`Enriched:  ${enriched}`);
  console.log(`Success:   ${processed > 0 ? ((enriched / processed) * 100).toFixed(1) : 0}%`);
}

main().catch(console.error);