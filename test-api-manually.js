// Simple test script to verify API endpoints work correctly
const fs = require('fs');
const path = require('path');

// Read the sample Python file
const pythonCode = fs.readFileSync(path.join(__dirname, 'tests', 'sample_python_script.py'), 'utf8');

async function testAPIFlow() {
  console.log('🧪 Testing API Flow...\n');

  try {
    // Test 1: Check if server is running
    console.log('1️⃣ Testing server health...');
    const healthResponse = await fetch('http://localhost:3000/api/generate-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentation: null, filename: 'test.py', format: 'docx' })
    });
    
    console.log(`Response status: ${healthResponse.status}`);
    const responseText = await healthResponse.text();
    console.log(`Response body: ${responseText}`);
    
    if (healthResponse.status === 400) {
      console.log('✅ Server is running and API endpoint responds correctly (expected 400 for null documentation)');
    } else {
      console.log('❌ Unexpected response from server');
    }

    // Test 2: Test OpenAI proxy (will work if OPENAI_API_KEY is set)
    console.log('\n2️⃣ Testing OpenAI proxy...');
    console.log('   (This will only work if OPENAI_API_KEY is properly configured)');
    
    const openaiResponse = await fetch('http://localhost:3000/api/openai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pythonCode: '# Simple test\nprint("Hello, world!")',
        filename: 'test.py'
      })
    });

    if (openaiResponse.ok) {
      console.log('✅ OpenAI proxy endpoint accessible');
    } else {
      const error = await openaiResponse.json();
      console.log(`⚠️  OpenAI proxy returned error: ${error.error}`);
      console.log('   This is expected if OPENAI_API_KEY is not configured');
    }

    // Test 3: Test DOCX generation with mock data
    console.log('\n3️⃣ Testing DOCX generation...');
    
    const mockDocumentation = {
      description: 'Test documentation',
      tableGrain: 'id',
      dataSources: ['test_table'],
      databricksTables: [{ tableName: 'output_table', description: 'Test output' }],
      tableMetadata: [{
        tableName: 'output_table',
        columns: [{
          columnName: 'id',
          dataType: 'integer',
          description: 'Primary key',
          sampleValues: '1,2,3',
          sourceTable: 'test_table',
          sourceColumn: 'id'
        }]
      }],
      integratedRules: ['Test rule 1', 'Test rule 2']
    };

    const docxResponse = await fetch('http://localhost:3000/api/generate-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentation: mockDocumentation,
        filename: 'test.py',
        format: 'docx'
      })
    });

    console.log(`DOCX Response status: ${docxResponse.status}`);
    
    if (docxResponse.ok) {
      const buffer = await docxResponse.arrayBuffer();
      console.log(`✅ DOCX generation successful! Generated ${buffer.byteLength} bytes`);
    } else {
      const errorText = await docxResponse.text();
      console.log(`❌ DOCX generation failed: ${errorText}`);
    }

    console.log('\n🎉 API testing complete!');

  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.log('\n💡 Make sure the dev server is running with: npm run dev');
  }
}

// Run the test
testAPIFlow(); 