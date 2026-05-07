#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zpeedfgyuusscsrirzsg.supabase.co';
const supabaseServiceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwZWVkZmd5dXVzc2NzcmlyenNnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjM0MDA2MiwiZXhwIjoyMDkxOTE2MDYyfQ.l2xvahChIJ-nXaGAIhpw8I6yNWRskxpkdzweVrucOms';
const openaiApiKey = 'REDACTED_OPENAI_KEY';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function testEnrichment() {
  console.log('Testing thought enrichment...');

  try {
    // Fetch first 5 thoughts
    const { data: thoughts, error } = await supabase
      .from('thoughts')
      .select('id, content')
      .order('id', { ascending: true })
      .limit(5);

    if (error) {
      console.error('Error fetching thoughts:', error.message);
      return;
    }

    console.log(`Found ${thoughts.length} thoughts`);

    // Test OpenAI API
    const testPrompt = "Return JSON: {test: 'success'}";
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: testPrompt }],
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status, await response.text());
      return;
    }

    const result = await response.json();
    console.log('OpenAI API test successful:', result.choices[0].message.content);

    // Test updating a thought
    if (thoughts.length > 0) {
      const testThought = thoughts[0];
      const updateData = {
        type: 'reference',
        metadata: {
          test: true,
          timestamp: new Date().toISOString(),
        },
      };

      const { error: updateError } = await supabase
        .from('thoughts')
        .update(updateData)
        .eq('id', testThought.id);

      if (updateError) {
        console.error('Error updating thought:', updateError.message);
      } else {
        console.log('Successfully updated thought:', testThought.id);
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testEnrichment();