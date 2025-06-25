// Enhanced test script to verify API endpoints with end-to-end SSE testing
const fs = require('fs');
const path = require('path');

// Read the sample Python file
const pythonCode = fs.readFileSync(path.join(__dirname, 'tests', 'sample_python_script.py'), 'utf8');

// Test assertion helper
function assert(condition, message) {
  if (!condition) {
    throw new Error(`❌ Assertion failed: ${message}`);
  }
  console.log(`✅ ${message}`);
}

// Comprehensive end-to-end API test
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

    // Test 2: End-to-end SSE streaming test with Python file upload
    console.log('\n2️⃣ END-TO-END TEST: Upload Python file and validate SSE stream...');
    console.log('   (This will only work if OPENAI_API_KEY is properly configured)');
    
    const openaiResponse = await fetch('http://localhost:3000/api/openai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pythonCode: pythonCode, // Use the full sample Python script
        filename: 'sample_python_script.py'
      })
    });

    if (openaiResponse.ok) {
      console.log('✅ OpenAI proxy endpoint accessible, testing SSE parsing...');
      
      try {
        // Import decodeSSE function for testing
        const { decodeSSE } = await import('./src/lib/utils.ts');
        
        console.log('   📡 Parsing SSE stream and validating events...');
        let frameCount = 0;
        let hasProgressEvent = false;
        let hasCompleteEvent = false;
        let hasValidJSONFrames = true;
        let finalDocumentation = null;
        
        for await (const frame of decodeSSE(openaiResponse)) {
          frameCount++;
          console.log(`   📦 Frame ${frameCount}:`, JSON.stringify(frame, null, 2));
          
          // Check for progress events
          if (frame && typeof frame.progress !== 'undefined') {
            hasProgressEvent = true;
            console.log(`   ⏳ Progress event detected: ${frame.progress}`);
          }
          
          // Check for completion event
          if (frame && frame.complete === true) {
            hasCompleteEvent = true;
            finalDocumentation = frame.documentation || frame.result;
            console.log('   🎉 Completion event detected!');
          }
          
          // Validate JSON structure
          if (frame === undefined || frame === null) {
            hasValidJSONFrames = false;
            console.log('   ⚠️  Invalid JSON frame detected');
          }
          
          // Stop after completion or higher frame limit
          if (frame && frame.complete) {
            console.log('   🎉 Completion event detected - stopping...');
            break;
          }
          
          if (frameCount >= 200) {
            console.log('   ⏹️  Stopping after 200 frames to avoid excessive output...');
            break;
          }
          
          if (frame && frame.error) {
            console.log('   ❌ Error event detected:', frame.error);
            break;
          }
        }
        
        console.log(`\n   📊 SSE Stream Analysis:`);
        console.log(`   - Total frames processed: ${frameCount}`);
        console.log(`   - Has progress events: ${hasProgressEvent}`);
        console.log(`   - Has completion event: ${hasCompleteEvent}`);
        console.log(`   - All frames valid JSON: ${hasValidJSONFrames}`);
        
        // Assertions for end-to-end test
        assert(frameCount > 0, 'At least one SSE frame should be received');
        assert(hasValidJSONFrames, 'All SSE frames should be valid JSON');
        assert(hasProgressEvent, 'At least one progress event should be received');
        assert(hasCompleteEvent, 'Final completion event should be received');
        
        if (finalDocumentation) {
          console.log('   📄 Final documentation structure:');
          console.log(`   - Has description: ${!!finalDocumentation.description}`);
          console.log(`   - Has databricksTables: ${!!finalDocumentation.databricksTables}`);
          console.log(`   - Has tableMetadata: ${!!finalDocumentation.tableMetadata}`);
          console.log(`   - Has integratedRules: ${!!finalDocumentation.integratedRules}`);
          
          assert(finalDocumentation.description, 'Final documentation should have description');
          assert(Array.isArray(finalDocumentation.databricksTables), 'Final documentation should have databricksTables array');
        }
        
        console.log('\n   🎯 END-TO-END TEST PASSED: SSE streaming works correctly!');
        
      } catch (error) {
        console.log('   ❌ SSE parsing failed:', error.message);
        console.log('   🐛 This might be the bug we are looking for!');
        
        // Try to get raw stream content for debugging
        const openaiResponse2 = await fetch('http://localhost:3000/api/openai-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pythonCode: '# Simple test\nprint("Hello, world!")',
            filename: 'test.py'
          })
        });
        
        if (openaiResponse2.body) {
          const reader = openaiResponse2.body.getReader();
          const decoder = new TextDecoder();
          let chunk_count = 0;
          
          console.log('   🔍 Raw stream content (first few chunks):');
          try {
            while (chunk_count < 3) {
              const { done, value } = await reader.read();
              if (done) break;
              
              const text = decoder.decode(value, { stream: true });
              console.log(`   Raw chunk ${chunk_count + 1}:`, JSON.stringify(text));
              chunk_count++;
            }
          } finally {
            reader.releaseLock();
          }
        }
        
        throw error; // Re-throw to fail the test
      }
      
    } else {
      const errorText = await openaiResponse.text();
      console.log(`⚠️  OpenAI proxy returned error: ${errorText}`);
      console.log('   This is expected if OPENAI_API_KEY is not configured');
      
      // If no API key, we can't test the full flow, but we can validate the error response
      if (openaiResponse.status === 401 || errorText.includes('API key') || errorText.includes('unauthorized')) {
        console.log('   ✅ API key validation works correctly (expected when not configured)');
      } else {
        throw new Error(`Unexpected error response: ${errorText}`);
      }
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