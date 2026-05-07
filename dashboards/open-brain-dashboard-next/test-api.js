// Test script to verify API response format
const API_URL = 'https://zpeedfgyuusscsrirzsg.supabase.co/functions/v1/open-brain-rest';
const API_KEY = 'c5061efb5c64a3e54aa4d340effd8f446d48d0921b683cef97c771dcf496a672';

async function testAPI() {
  console.log('Testing API endpoints...');

  try {
    // Test thoughts endpoint
    console.log('\n1. Testing /thoughts...');
    const thoughtsRes = await fetch(`${API_URL}/thoughts?per_page=5`, {
      headers: {
        'x-brain-key': API_KEY,
        'Content-Type': 'application/json'
      }
    });
    const thoughtsData = await thoughtsRes.json();
    console.log('Status:', thoughtsRes.status);
    console.log('Data structure:', JSON.stringify(thoughtsData, null, 2).substring(0, 500));

    // Test stats endpoint
    console.log('\n2. Testing /stats...');
    const statsRes = await fetch(`${API_URL}/stats`, {
      headers: {
        'x-brain-key': API_KEY,
        'Content-Type': 'application/json'
      }
    });
    const statsData = await statsRes.json();
    console.log('Status:', statsRes.status);
    console.log('Data structure:', JSON.stringify(statsData, null, 2).substring(0, 500));

    // Test search endpoint
    console.log('\n3. Testing /search...');
    const searchRes = await fetch(`${API_URL}/search`, {
      method: 'POST',
      headers: {
        'x-brain-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: 'test', limit: 5, mode: 'text' })
    });
    const searchData = await searchRes.json();
    console.log('Status:', searchRes.status);
    console.log('Data structure:', JSON.stringify(searchData, null, 2).substring(0, 500));

  } catch (error) {
    console.error('Error testing API:', error);
  }
}

testAPI();