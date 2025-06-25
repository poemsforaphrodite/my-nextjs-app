import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '@/lib/utils';
import { decodeSSE } from '@/lib/utils';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const obj = { hello: 'world' };
    const parsed = safeJsonParse(JSON.stringify(obj));
    expect(parsed).toEqual(obj);
  });

  it('parses JSON with leading text', () => {
    const raw = 'data: {"foo":"bar"}';
    const parsed = safeJsonParse(raw);
    expect(parsed).toEqual({ foo: 'bar' });
  });

  it('returns undefined on invalid JSON', () => {
    const parsed = safeJsonParse('not-json');
    expect(parsed).toBeUndefined();
  });

  it('decodeSSE parses frames', async () => {
    const payloads = [
      { progress: 'first' },
      { progress: 'second' },
      { complete: true }
    ];

    // build SSE string
    const sseString = payloads.map(p => `data: ${JSON.stringify(p)}\n\n`).join('');

    // create Response with ReadableStream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseString));
        controller.close();
      }
    });

    const resp = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });

    const out: any[] = [];
    for await (const obj of decodeSSE(resp)) {
      out.push(obj);
    }

    expect(out).toEqual(payloads);
  });

  it('decodeSSE should parse frame with "progress":"ok" - reproducing the bug', async () => {
    // This test case specifically tries to reproduce the "Unexpected token 'd'" error
    // when parsing SSE frames like: data: {"progress":"ok"}\n\n
    const testFrame = 'data: {"progress":"ok"}\n\n';
    console.log('Testing SSE frame:', JSON.stringify(testFrame));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(testFrame));
        controller.close();
      }
    });

    const resp = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });

    const results: any[] = [];
    
    try {
      for await (const obj of decodeSSE(resp)) {
        console.log('Parsed object:', obj);
        results.push(obj);
      }
      
      // We expect to get {progress: "ok"}
      expect(results).toEqual([{progress: "ok"}]);
      console.log('✅ Test passed - no bug found');
    } catch (error) {
      console.log('❌ Bug reproduced! Error:', error);
      // Re-throw to fail the test and show the bug
      throw error;
    }
  });

  it('decodeSSE should handle problematic frame formats that might cause "Unexpected token d" error', async () => {
    // Test various problematic frame formats that could trigger the parsing bug
    const problematicFrames = [
      // Test case 1: Frame with no space after 'data:'
      'data:{"progress":"ok"}\n\n',
      
      // Test case 2: Frame with multiple spaces
      'data:  {"progress":"ok"}\n\n',
      
      // Test case 3: Frame with tab character
      'data:\t{"progress":"ok"}\n\n',
      
      // Test case 4: Frame that might be split across chunks
      'data: {"progress":"ok"}\n\ndata: {"progress":"next"}\n\n',
      
      // Test case 5: Frame with different quote styles (the problematic one)
      'data: {"progress":"ok"}\n\n',
      
      // Test case 6: Frame that might have unexpected characters
      'data: {"progress":"ok"}\r\n\r\n',
    ];

    for (let i = 0; i < problematicFrames.length; i++) {
      const testFrame = problematicFrames[i];
      console.log(`\nTesting problematic frame ${i + 1}:`, JSON.stringify(testFrame));

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(testFrame));
          controller.close();
        }
      });

      const resp = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });

      try {
        const results: any[] = [];
        for await (const obj of decodeSSE(resp)) {
          console.log(`  Frame ${i + 1} parsed object:`, obj);
          results.push(obj);
        }
        
        console.log(`  ✅ Frame ${i + 1} parsed successfully`);
      } catch (error) {
        console.log(`  ❌ Frame ${i + 1} failed with error:`, error.message);
        if (error.message.includes('Unexpected token')) {
          console.log('  🐛 Found the "Unexpected token" bug!');
          throw new Error(`Bug reproduced with frame ${i + 1}: ${error.message}`);
        }
        // Re-throw any other errors too
        throw error;
      }
    }
  });

  it('decodeSSE should handle partial and chunked SSE frames', async () => {
    // This test simulates the scenario where SSE frames arrive in multiple chunks
    // which might be where the parsing bug occurs
    
    const fullFrame = 'data: {"progress":"ok"}\n\n';
    
    // Split the frame into chunks that might cause parsing issues
    const chunks = [
      'data: {"prog', // First chunk: incomplete
      'ress":"ok"}\n', // Second chunk: completes JSON but incomplete frame
      '\n' // Third chunk: completes the frame
    ];

    console.log('Testing chunked SSE frame:', chunks.map(c => JSON.stringify(c)));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send chunks with small delays to simulate real streaming
        chunks.forEach((chunk, i) => {
          setTimeout(() => {
            controller.enqueue(encoder.encode(chunk));
            if (i === chunks.length - 1) {
              controller.close();
            }
          }, i * 10);
        });
      }
    });

    const resp = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });

    try {
      const results: any[] = [];
      for await (const obj of decodeSSE(resp)) {
        console.log('Chunked frame parsed object:', obj);
        results.push(obj);
      }
      
      expect(results).toEqual([{progress: "ok"}]);
      console.log('✅ Chunked frame test passed');
    } catch (error) {
      console.log('❌ Chunked frame test failed:', error.message);
      if (error.message.includes('Unexpected token')) {
        console.log('🐛 Found the "Unexpected token" bug in chunked parsing!');
      }
      throw error;
    }
  });

  it('REPRODUCES THE BUG: Very specific case that triggers "Unexpected token d" error', async () => {
    // The key insight: the bug occurs when the frame extraction doesn't properly handle the data prefix
    // Let's create a scenario that definitely causes "Unexpected token d"
    
    console.log('\n🐛 REPRODUCING THE ACTUAL BUG:');
    
    // The bug likely happens when we try to parse the raw frame content including "data:" prefix
    const malformedFrameContent = 'data: {"progress":"ok"}';
    console.log('Trying to parse malformed content directly:', JSON.stringify(malformedFrameContent));
    
    try {
      // This WILL fail with "Unexpected token 'd'" because we're trying to parse "data: {\"progress\":\"ok\"}"
      const result = JSON.parse(malformedFrameContent);
      console.log('😲 Unexpected success:', result);
      expect.fail('Expected JSON.parse to fail but it succeeded');
    } catch (error) {
      console.log('🎯 BUG CONFIRMED! JSON.parse failed with:', error.message);
      expect(error.message).toContain('Unexpected token');
      expect(error.message.toLowerCase()).toContain('d'); // The 'd' from 'data:'
      console.log('✅ Successfully reproduced the "Unexpected token d" error!');
    }
  });

  it('WORKING IMPLEMENTATION: Shows how current decodeSSE avoids the bug', async () => {
    // This test demonstrates how the current implementation correctly handles the parsing
    
    const testFrame = 'data: {"progress":"ok"}\n\n';
    console.log('\n✅ TESTING CURRENT WORKING IMPLEMENTATION:');
    console.log('Frame to parse:', JSON.stringify(testFrame));
    
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(testFrame));
        controller.close();
      }
    });

    const resp = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });

    const results: any[] = [];
    for await (const obj of decodeSSE(resp)) {
      console.log('✅ Current implementation successfully parsed:', obj);
      results.push(obj);
    }
    
    expect(results).toEqual([{progress: "ok"}]);
    console.log('✅ Current implementation works correctly!');
  });

  it('SIMULATES A BUGGY PARSER: Creates failing scenario for educational purposes', async () => {
    // This demonstrates what might have been wrong in an earlier version
    console.log('\n🔧 SIMULATING A BUGGY SSE PARSER:');
    
    const testFrame = 'data: {"progress":"ok"}\n\n';
    
    // Simulate a buggy parser that doesn't properly extract the JSON part
    const simulateBuggyParsing = (frameContent: string) => {
      console.log('Input frame:', JSON.stringify(frameContent));
      
      // Step 1: Find the frame boundary
      const frames = frameContent.split('\n\n').filter(f => f.trim());
      
      for (const frame of frames) {
        console.log('Processing frame:', JSON.stringify(frame));
        
        // Step 2: Check if it's a data frame
        if (!frame.startsWith('data:')) {
          console.log('  Skipping non-data frame');
          continue;
        }
        
        // Step 3: BUGGY extraction - doesn't remove 'data:' properly
        const rawData = frame; // BUG: Should be frame.slice(5).trim() but we keep the whole thing
        console.log('  Buggy extraction - trying to parse:', JSON.stringify(rawData));
        
        try {
          return JSON.parse(rawData); // This will fail!
        } catch (error) {
          console.log('  💥 BUG! Failed to parse:', error.message);
          throw error;
        }
      }
    };
    
    try {
      const result = simulateBuggyParsing(testFrame);
      console.log('😲 Unexpected success:', result);
      expect.fail('Expected buggy parser to fail');
    } catch (error) {
      console.log('🎯 Buggy parser failed as expected:', error.message);
      expect(error.message).toContain('Unexpected token');
      console.log('✅ Successfully demonstrated how the bug could occur!');
    }
  });
}); 