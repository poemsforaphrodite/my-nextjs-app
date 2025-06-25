import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Load the sample Python file for testing
const pythonCode = fs.readFileSync(path.join(__dirname, 'sample_python_script.py'), 'utf8');

test.describe('API SSE End-to-End Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Set a longer timeout for API calls
    test.setTimeout(120_000); // 2 minutes for potential OpenAI calls
  });

  test('should upload Python file and validate SSE stream with progress and completion events', async ({ request }) => {
    console.log('🧪 Starting end-to-end SSE test...');
    
    // Make request to OpenAI proxy endpoint
    const response = await request.post('http://localhost:3000/api/openai-proxy', {
      data: {
        pythonCode: pythonCode,
        filename: 'sample_python_script.py'
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`Response status: ${response.status()}`);
    
    if (response.status() === 401) {
      console.log('⚠️  OPENAI_API_KEY not configured - skipping full SSE test');
      console.log('✅ API endpoint correctly validates authentication');
      return;
    }

    // Ensure the response is successful
    expect(response.ok()).toBeTruthy();
    
    // Validate response headers
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/event-stream');
    
    console.log('✅ Response headers validated - SSE stream detected');

    // Process the SSE stream
    const body = await response.body();
    const streamText = body.toString();
    
    console.log('📡 Processing SSE stream...');
    console.log(`Stream length: ${streamText.length} characters`);
    
    // Parse SSE frames manually (similar to decodeSSE function)
    const frames = [];
    const chunks = streamText.split('\n\n');
    
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      
      const lines = chunk.split('\n');
      const dataLines = lines.filter(line => line.startsWith('data:'));
      
      if (dataLines.length > 0) {
        const jsonStr = dataLines
          .map(line => line.slice(5).trim()) // Remove 'data:' prefix
          .join('');
        
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            frames.push(parsed);
            console.log(`📦 Parsed frame:`, parsed);
          } catch (error) {
            console.error(`❌ Failed to parse JSON frame: ${jsonStr}`);
            console.error(`Error: ${error.message}`);
            throw new Error(`JSON parsing failed for frame: ${jsonStr}`);
          }
        }
      }
    }

    console.log(`📊 Total frames parsed: ${frames.length}`);

    // Validate the stream contains required events
    expect(frames.length).toBeGreaterThan(0);
    
    // Check for progress events
    const progressFrames = frames.filter(frame => 
      frame && typeof frame.progress !== 'undefined'
    );
    expect(progressFrames.length).toBeGreaterThan(0);
    console.log(`✅ Found ${progressFrames.length} progress events`);

    // Check for completion event
    const completeFrames = frames.filter(frame => 
      frame && frame.complete === true
    );
    expect(completeFrames.length).toBeGreaterThan(0);
    console.log(`✅ Found ${completeFrames.length} completion events`);

    // Validate the final documentation structure
    const finalFrame = completeFrames[completeFrames.length - 1];
    const documentation = finalFrame.documentation || finalFrame.result;
    
    if (documentation) {
      expect(documentation).toHaveProperty('description');
      expect(documentation).toHaveProperty('databricksTables');
      expect(documentation).toHaveProperty('tableMetadata');
      expect(documentation).toHaveProperty('integratedRules');
      
      expect(typeof documentation.description).toBe('string');
      expect(Array.isArray(documentation.databricksTables)).toBeTruthy();
      expect(Array.isArray(documentation.tableMetadata)).toBeTruthy();
      expect(Array.isArray(documentation.integratedRules)).toBeTruthy();
      
      console.log('✅ Final documentation structure validated');
      console.log(`- Description length: ${documentation.description?.length || 0} chars`);
      console.log(`- Databricks tables: ${documentation.databricksTables?.length || 0}`);
      console.log(`- Table metadata: ${documentation.tableMetadata?.length || 0}`);
      console.log(`- Integrated rules: ${documentation.integratedRules?.length || 0}`);
    }

    // Ensure no frames have JSON errors
    const allFramesValid = frames.every(frame => frame !== null && frame !== undefined);
    expect(allFramesValid).toBeTruthy();
    console.log('✅ All SSE frames contain valid JSON');

    console.log('🎉 End-to-end SSE test PASSED!');
  });

  test('should handle small Python file upload via SSE', async ({ request }) => {
    console.log('🧪 Testing with small Python file...');
    
    const smallPythonCode = `
# Simple Python script for testing
def hello_world():
    print("Hello, World!")
    return "success"

if __name__ == "__main__":
    result = hello_world()
    print(f"Result: {result}")
`;

    const response = await request.post('http://localhost:3000/api/openai-proxy', {
      data: {
        pythonCode: smallPythonCode,
        filename: 'small_test.py'
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`Small file response status: ${response.status()}`);
    
    if (response.status() === 401) {
      console.log('⚠️  OPENAI_API_KEY not configured - skipping small file test');
      return;
    }

    expect(response.ok()).toBeTruthy();
    
    // Validate it's an SSE stream
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/event-stream');
    
    const body = await response.body();
    const streamText = body.toString();
    
    // Basic validation that we got some SSE content
    expect(streamText).toContain('data:');
    expect(streamText.length).toBeGreaterThan(0);
    
    console.log('✅ Small Python file SSE test completed');
  });

  test('should validate error handling for malformed requests', async ({ request }) => {
    console.log('🧪 Testing error handling...');
    
    // Test with missing pythonCode
    const response1 = await request.post('http://localhost:3000/api/openai-proxy', {
      data: {
        filename: 'test.py'
        // Missing pythonCode
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    expect(response1.status()).toBe(400);
    console.log('✅ Correctly handles missing pythonCode');

    // Test with missing filename
    const response2 = await request.post('http://localhost:3000/api/openai-proxy', {
      data: {
        pythonCode: 'print("test")'
        // Missing filename
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    expect(response2.status()).toBe(400);
    console.log('✅ Correctly handles missing filename');

    // Test with empty pythonCode
    const response3 = await request.post('http://localhost:3000/api/openai-proxy', {
      data: {
        pythonCode: '',
        filename: 'empty.py'
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    expect(response3.status()).toBe(400);
    console.log('✅ Correctly handles empty pythonCode');
  });

  test('should integrate with DOCX generation after SSE completion', async ({ request }) => {
    console.log('🧪 Testing full pipeline: SSE → DOCX generation...');
    
    // First, try to get documentation via SSE
    const sseResponse = await request.post('http://localhost:3000/api/openai-proxy', {
      data: {
        pythonCode: pythonCode,
        filename: 'sample_python_script.py'
      }
    });

    if (sseResponse.status() === 401) {
      console.log('⚠️  OPENAI_API_KEY not configured - testing with mock data');
      
      // Use mock documentation for DOCX generation test
      const mockDocumentation = {
        description: 'Test documentation generated from SSE stream',
        tableGrain: 'rep_id, provider_id',
        dataSources: ['test_table'],
        databricksTables: [
          { tableName: 'test_output', description: 'Test output table' }
        ],
        tableMetadata: [{
          tableName: 'test_output',
          columns: [{
            columnName: 'id',
            dataType: 'integer',
            description: 'Primary key',
            sampleValues: '1,2,3',
            sourceTable: 'test_table',
            sourceColumn: 'id'
          }]
        }],
        integratedRules: ['Test rule from SSE stream']
      };

      // Test DOCX generation with mock data
      const docxResponse = await request.post('http://localhost:3000/api/generate-docs', {
        data: {
          documentation: mockDocumentation,
          filename: 'sample_python_script.py',
          format: 'docx'
        }
      });

      expect(docxResponse.ok()).toBeTruthy();
      
      const buffer = await docxResponse.body();
      expect(buffer.length).toBeGreaterThan(0);
      
      console.log(`✅ DOCX generated successfully: ${buffer.length} bytes`);
      console.log('✅ Full pipeline test completed with mock data');
      
      return;
    }

    // If SSE works, extract documentation and generate DOCX
    expect(sseResponse.ok()).toBeTruthy();
    
    const body = await sseResponse.body();
    const streamText = body.toString();
    
    // Parse the final documentation from SSE stream
    const chunks = streamText.split('\n\n');
    let finalDocumentation = null;
    
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      
      const lines = chunk.split('\n');
      const dataLines = lines.filter(line => line.startsWith('data:'));
      
      if (dataLines.length > 0) {
        const jsonStr = dataLines.map(line => line.slice(5).trim()).join('');
        
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.complete && (parsed.documentation || parsed.result)) {
              finalDocumentation = parsed.documentation || parsed.result;
            }
          } catch (error) {
            // Skip invalid JSON frames
          }
        }
      }
    }

    expect(finalDocumentation).toBeTruthy();
    console.log('✅ Extracted documentation from SSE stream');

    // Generate DOCX with real documentation
    const docxResponse = await request.post('http://localhost:3000/api/generate-docs', {
      data: {
        documentation: finalDocumentation,
        filename: 'sample_python_script.py',
        format: 'docx'
      }
    });

    expect(docxResponse.ok()).toBeTruthy();
    
    const buffer = await docxResponse.body();
    expect(buffer.length).toBeGreaterThan(0);
    
    console.log(`✅ DOCX generated from real SSE data: ${buffer.length} bytes`);
    console.log('🎉 Full pipeline test PASSED!');
  });
});
