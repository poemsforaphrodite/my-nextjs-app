import { decodeSSE } from '../src/lib/utils';

describe('decodeSSE', () => {
  // Helper function to create a mocked Response with ReadableStream
  const createMockResponse = (chunks: string[]): Response => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach(chunk => {
          controller.enqueue(encoder.encode(chunk));
        });
        controller.close();
      }
    });
    return new Response(stream, { 
      headers: { 'Content-Type': 'text/event-stream' } 
    });
  };

  // Helper function to collect all yielded values from the generator
  const collectResults = async (response: Response): Promise<unknown[]> => {
    const results: unknown[] = [];
    for await (const obj of decodeSSE(response)) {
      results.push(obj);
    }
    return results;
  };

  beforeEach(() => {
    // Clear any console warnings before each test
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console.warn after each test
    jest.restoreAllMocks();
  });

  it('should handle single-line SSE frames', async () => {
    const sseData = [
      'data: {"type": "message", "content": "Hello"}\n\n',
      'data: {"type": "message", "content": "World"}\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    expect(results).toEqual([
      { type: "message", content: "Hello" },
      { type: "message", content: "World" }
    ]);
  });

  it('should handle multi-line SSE frames', async () => {
    const sseData = [
      'data: {"type": "start"}\n',
      'data: {"progress": 50}\n',
      'data: {"complete": true}\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    expect(results).toEqual([
      { type: "start", progress: 50, complete: true }
    ]);
  });

  it('should handle empty data fields', async () => {
    const sseData = [
      'data: \n\n',
      'data: {"valid": "data"}\n\n',
      'data:\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    // Should only yield the valid JSON object, skipping empty data
    expect(results).toEqual([
      { valid: "data" }
    ]);
  });

  it('should handle heartbeat frames (empty data)', async () => {
    const sseData = [
      ': heartbeat\n\n',
      'data: {"message": "actual data"}\n\n',
      ': another heartbeat\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    // Should only yield the actual data, ignoring heartbeat comments
    expect(results).toEqual([
      { message: "actual data" }
    ]);
  });

  it('should handle invalid JSON gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    const sseData = [
      'data: {"valid": "json"}\n\n',
      'data: {invalid json}\n\n',
      'data: {"another": "valid"}\n\n',
      'data: malformed\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    // Should only yield successfully parsed objects
    expect(results).toEqual([
      { valid: "json" },
      { another: "valid" }
    ]);
    
    // Should log warnings for invalid JSON
    expect(consoleSpy).toHaveBeenCalledWith('Failed to parse SSE frame:', '{invalid json}');
    expect(consoleSpy).toHaveBeenCalledWith('Failed to parse SSE frame:', 'malformed');
  });

  it('should handle mixed valid and invalid frames', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    const sseData = [
      'data: {"step": 1}\n\n',
      'event: custom\n',
      'data: not-json\n\n',
      'data: {"step": 2}\n\n',
      ': comment\n\n',
      'data: {"step": 3}\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    expect(results).toEqual([
      { step: 1 },
      { step: 2 },
      { step: 3 }
    ]);
    
    expect(consoleSpy).toHaveBeenCalledWith('Failed to parse SSE frame:', 'not-json');
  });

  it('should handle chunked data arriving in multiple pieces', async () => {
    // Simulate data arriving in chunks that split across frame boundaries
    const chunks = [
      'data: {"part": 1}\n\ndata: {"pa',
      'rt": 2}\n\ndata: {"part"',
      ': 3}\n\n'
    ];
    
    const response = createMockResponse(chunks);
    const results = await collectResults(response);
    
    expect(results).toEqual([
      { part: 1 },
      { part: 2 },
      { part: 3 }
    ]);
  });

  it('should handle frames with various whitespace patterns', async () => {
    const sseData = [
      'data:{"no_space":true}\n\n',
      'data: {"single_space":true}\n\n',
      'data:  {"double_space":true}\n\n',
      'data:\t{"tab_space":true}\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    expect(results).toEqual([
      { no_space: true },
      { single_space: true },
      { double_space: true },
      { tab_space: true }
    ]);
  });

  it('should handle complex JSON with nested objects and arrays', async () => {
    const complexData = {
      user: { id: 123, name: "John Doe" },
      items: [{ id: 1, name: "Item 1" }, { id: 2, name: "Item 2" }],
      metadata: { timestamp: "2023-01-01T00:00:00Z" }
    };
    
    const sseData = [
      `data: ${JSON.stringify(complexData)}\n\n`
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    expect(results).toEqual([complexData]);
  });

  it('should handle empty response body', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      }
    });
    const response = new Response(stream);
    
    const results = await collectResults(response);
    
    expect(results).toEqual([]);
  });

  it('should handle response with no body', async () => {
    const response = new Response(null);
    
    const results = await collectResults(response);
    
    expect(results).toEqual([]);
  });

  it('should verify no unhandled promise rejections occur', async () => {
    const unhandledRejections: any[] = [];
    const originalHandler = process.listeners('unhandledRejection');
    
    // Add a temporary listener to catch any unhandled rejections
    const testHandler = (reason: any) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', testHandler);
    
    try {
      // Test with various problematic scenarios
      const problematicData = [
        'data: {"valid": true}\n\n',
        'data: {broken json\n\n',
        'malformed frame without data prefix\n\n',
        'data: {"another": "valid"}\n\n'
      ];
      
      const response = createMockResponse(problematicData);
      const results = await collectResults(response);
      
      // Should still yield valid objects
      expect(results).toEqual([
        { valid: true },
        { another: "valid" }
      ]);
      
      // Wait a bit to ensure any async operations complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify no unhandled promise rejections occurred
      expect(unhandledRejections).toEqual([]);
      
    } finally {
      // Clean up the test handler
      process.removeListener('unhandledRejection', testHandler);
    }
  });

  it('should handle safeJsonParse fallback scenarios', async () => {
    // Test frames that would fail normal JSON.parse but might succeed with safeJsonParse
    const sseData = [
      'data: prefix{"valid": "json"}suffix\n\n',
      'data: {"normal": "json"}\n\n',
      'data: some text {"embedded": "json"} more text\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    expect(results).toEqual([
      { valid: "json" },
      { normal: "json" },
      { embedded: "json" }
    ]);
  });

  it('should handle rapid-fire frames', async () => {
    // Generate many frames quickly to test buffering
    const frames = Array.from({ length: 100 }, (_, i) => 
      `data: {"frame": ${i}}\n\n`
    );
    
    const response = createMockResponse(frames);
    const results = await collectResults(response);
    
    expect(results).toHaveLength(100);
    expect(results[0]).toEqual({ frame: 0 });
    expect(results[99]).toEqual({ frame: 99 });
  });

  it('should handle frames with special characters and unicode', async () => {
    const sseData = [
      'data: {"emoji": "🚀", "unicode": "héllo", "special": "quotes\\"and\\nlines"}\n\n'
    ];
    
    const response = createMockResponse(sseData);
    const results = await collectResults(response);
    
    expect(results).toEqual([
      { emoji: "🚀", unicode: "héllo", special: "quotes\"and\nlines" }
    ]);
  });
});
