// Test script for stress test function
const fetch = require('node-fetch');

async function testStressTest() {
  const url = 'https://zpeedfgyuusscsrirzsg.functions.supabase.co/stress-test/status';
  const options = {
    method: 'GET',
    headers: {
      'apikey': 'a66d5f7ac518e00d12129c23779dd5ed48ce17a2b2c2fcec00ce6c730630a03e',
      'Content-Type': 'application/json'
    }
  };

  try {
    const response = await fetch(url, options);
    console.log('Status:', response.status);
    console.log('Headers:', response.headers.raw());

    if (response.ok) {
      const data = await response.json();
      console.log('Response:', data);
    } else {
      const text = await response.text();
      console.log('Error:', text);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
}

testStressTest();