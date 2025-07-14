import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  generateEmbedding, 
  generateEmbeddings, 
  embedAndStoreChunks,
  searchSimilarContent,
  hybridSearch,
  getRelevantContext 
} from '@/lib/embeddings';
import { DocumentChunk } from '@/lib/chunking';

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(3072).fill(0.1) }]
      })
    }
  }))
}));

// Mock Pinecone
vi.mock('@/lib/pinecone', () => ({
  upsertVector: vi.fn().mockResolvedValue(undefined),
  searchVectors: vi.fn().mockResolvedValue([
    {
      id: 'test-1',
      score: 0.95,
      metadata: {
        content: 'Test content 1',
        type: 'document',
        source: 'test-doc-1.py'
      }
    },
    {
      id: 'test-2', 
      score: 0.87,
      metadata: {
        content: 'Test content 2',
        type: 'code',
        source: 'test-code-1.py'
      }
    }
  ]),
  INDEXES: {
    DOCUMENTS: 'n8n',
    CODE: 'n8n',
    QA: 'n8n'
  }
}));

describe('Embeddings', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for single text', async () => {
      const text = 'Test text for embedding';
      const embedding = await generateEmbedding(text);
      
      expect(embedding).toHaveLength(3072);
      expect(embedding[0]).toBe(0.1);
    });

    it('should handle OpenAI API errors', async () => {
      const OpenAI = await import('openai');
      const mockOpenAI = vi.mocked(OpenAI.default);
      const instance = new mockOpenAI();
      vi.mocked(instance.embeddings.create).mockRejectedValueOnce(new Error('API Error'));

      await expect(generateEmbedding('test')).rejects.toThrow('API Error');
    });
  });

  describe('generateEmbeddings', () => {
    it('should generate embeddings for multiple texts', async () => {
      const texts = ['Text 1', 'Text 2', 'Text 3'];
      
      const OpenAI = await import('openai');
      const mockOpenAI = vi.mocked(OpenAI.default);
      const instance = new mockOpenAI();
      vi.mocked(instance.embeddings.create).mockResolvedValueOnce({
        data: texts.map(() => ({ embedding: mockEmbedding }))
      } as any);

      const embeddings = await generateEmbeddings(texts);
      
      expect(embeddings).toHaveLength(3);
      expect(embeddings[0]).toHaveLength(3072);
    });

    it('should handle batch processing for large inputs', async () => {
      const texts = new Array(100).fill('test text');
      
      const OpenAI = await import('openai');
      const mockOpenAI = vi.mocked(OpenAI.default);
      const instance = new mockOpenAI();
      
      // Mock multiple batch calls
      vi.mocked(instance.embeddings.create)
        .mockResolvedValueOnce({
          data: new Array(50).fill({ embedding: new Array(3072).fill(0.1) })
        } as any)
        .mockResolvedValueOnce({
          data: new Array(50).fill({ embedding: new Array(3072).fill(0.1) })
        } as any);

      const embeddings = await generateEmbeddings(texts);
      
      expect(embeddings).toHaveLength(100);
      expect(instance.embeddings.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('embedAndStoreChunks', () => {
    it('should embed and store document chunks', async () => {
      const chunks: DocumentChunk[] = [
        {
          id: 'chunk-1',
          content: 'Test chunk content 1',
          metadata: {
            id: 'chunk-1',
            type: 'document',
            content: 'Test chunk content 1',
            source: 'test.py',
            timestamp: Date.now()
          },
          startIndex: 0,
          endIndex: 20
        },
        {
          id: 'chunk-2',
          content: 'Test chunk content 2',
          metadata: {
            id: 'chunk-2',
            type: 'code',
            content: 'Test chunk content 2',
            source: 'test.py',
            timestamp: Date.now()
          },
          startIndex: 20,
          endIndex: 40
        }
      ];

      const progressUpdates: number[] = [];
      const onProgress = (progress: number) => progressUpdates.push(progress);

      await embedAndStoreChunks(chunks, onProgress);

      // Verify progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(1);

      // Verify upsertVector was called
      const { upsertVector } = await import('@/lib/pinecone');
      expect(upsertVector).toHaveBeenCalledTimes(2);
    });

    it('should handle different chunk types', async () => {
      const chunks: DocumentChunk[] = [
        {
          id: 'doc-chunk',
          content: 'Document content',
          metadata: {
            id: 'doc-chunk',
            type: 'document',
            content: 'Document content',
            source: 'doc.md',
            timestamp: Date.now()
          },
          startIndex: 0,
          endIndex: 16
        },
        {
          id: 'code-chunk',
          content: 'def function(): pass',
          metadata: {
            id: 'code-chunk',
            type: 'code',
            content: 'def function(): pass',
            source: 'code.py',
            timestamp: Date.now()
          },
          startIndex: 0,
          endIndex: 20
        },
        {
          id: 'qa-chunk',
          content: 'Q: What is this? A: Test',
          metadata: {
            id: 'qa-chunk',
            type: 'qa',
            content: 'Q: What is this? A: Test',
            source: 'qa.txt',
            timestamp: Date.now()
          },
          startIndex: 0,
          endIndex: 24
        }
      ];

      await embedAndStoreChunks(chunks);

      const { upsertVector } = await import('@/lib/pinecone');
      expect(upsertVector).toHaveBeenCalledTimes(3);
      
      // Verify different index usage for different types
      expect(upsertVector).toHaveBeenCalledWith('n8n', expect.any(Array), expect.any(Object));
    });
  });

  describe('searchSimilarContent', () => {
    it('should search for similar content', async () => {
      const query = 'test search query';
      const results = await searchSimilarContent(query, 'document', 5);

      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('Test content 1');
      expect(results[0].score).toBe(0.95);
    });

    it('should handle different content types', async () => {
      await searchSimilarContent('query', 'code', 3);
      await searchSimilarContent('query', 'qa', 3);
      await searchSimilarContent('query', 'document', 3);

      const { searchVectors } = await import('@/lib/pinecone');
      expect(searchVectors).toHaveBeenCalledTimes(3);
    });

    it('should apply filters', async () => {
      const filter = { source: 'specific-file.py' };
      await searchSimilarContent('query', 'document', 5, filter);

      const { searchVectors } = await import('@/lib/pinecone');
      expect(searchVectors).toHaveBeenCalledWith(
        'n8n',
        expect.any(Array),
        5,
        filter
      );
    });
  });

  describe('hybridSearch', () => {
    it('should perform hybrid search across content types', async () => {
      const query = 'hybrid search test';
      const results = await hybridSearch(query, {
        includeDocuments: true,
        includeCode: true,
        includeQA: true,
        topK: 10
      });

      expect(results.combined).toHaveLength(6); // 2 results × 3 content types
      expect(results.documents).toBeDefined();
      expect(results.code).toBeDefined();
      expect(results.qa).toBeDefined();
    });

    it('should respect content type filters', async () => {
      const results = await hybridSearch('query', {
        includeDocuments: true,
        includeCode: false,
        includeQA: false,
        topK: 5
      });

      expect(results.documents).toHaveLength(2);
      expect(results.code).toHaveLength(0);
      expect(results.qa).toHaveLength(0);
    });

    it('should sort combined results by score', async () => {
      // Mock different scores for different content types
      const { searchVectors } = await import('@/lib/pinecone');
      vi.mocked(searchVectors)
        .mockResolvedValueOnce([{ ...mockSearchResults[0], score: 0.95 }])
        .mockResolvedValueOnce([{ ...mockSearchResults[1], score: 0.87 }])
        .mockResolvedValueOnce([{ id: 'qa-1', score: 0.91, metadata: { content: 'QA content' } }]);

      const results = await hybridSearch('query');

      expect(results.combined[0].score).toBe(0.95);
      expect(results.combined[1].score).toBe(0.91);
      expect(results.combined[2].score).toBe(0.87);
    });
  });

  describe('getRelevantContext', () => {
    it('should retrieve and format relevant context', async () => {
      const query = 'context retrieval test';
      const context = await getRelevantContext(query, 1000);

      expect(context).toContain('Test content 1');
      expect(context).toContain('Test content 2');
      expect(context).toContain('score: 0.95');
      expect(context).toContain('score: 0.87');
    });

    it('should respect token limits', async () => {
      const context = await getRelevantContext('query', 50); // Very small limit
      
      // Should contain some content but be limited
      expect(context.length).toBeLessThan(500);
    });

    it('should filter by minimum score', async () => {
      const context = await getRelevantContext('query', 4000, {
        minScore: 0.9 // Should filter out 0.87 score result
      });

      expect(context).toContain('Test content 1'); // score: 0.95
      expect(context).not.toContain('Test content 2'); // score: 0.87
    });

    it('should respect content type options', async () => {
      await getRelevantContext('query', 4000, {
        includeDocuments: true,
        includeCode: false,
        includeQA: false
      });

      // Should only search documents, not code or QA
      const { searchVectors } = await import('@/lib/pinecone');
      const calls = vi.mocked(searchVectors).mock.calls;
      expect(calls.length).toBe(1); // Only one search call for documents
    });
  });

  describe('error handling', () => {
    it('should handle embedding generation errors', async () => {
      const OpenAI = await import('openai');
      const mockOpenAI = vi.mocked(OpenAI.default);
      const instance = new mockOpenAI();
      vi.mocked(instance.embeddings.create).mockRejectedValueOnce(new Error('Embedding failed'));

      await expect(generateEmbedding('test')).rejects.toThrow('Embedding failed');
    });

    it('should handle search errors', async () => {
      const { searchVectors } = await import('@/lib/pinecone');
      vi.mocked(searchVectors).mockRejectedValueOnce(new Error('Search failed'));

      await expect(searchSimilarContent('query')).rejects.toThrow('Search failed');
    });

    it('should handle upsert errors during chunk storage', async () => {
      const { upsertVector } = await import('@/lib/pinecone');
      vi.mocked(upsertVector).mockRejectedValueOnce(new Error('Upsert failed'));

      const chunks: DocumentChunk[] = [{
        id: 'test',
        content: 'test',
        metadata: {
          id: 'test',
          type: 'document',
          content: 'test',
          source: 'test.py',
          timestamp: Date.now()
        },
        startIndex: 0,
        endIndex: 4
      }];

      await expect(embedAndStoreChunks(chunks)).rejects.toThrow('Upsert failed');
    });
  });

  describe('performance and batching', () => {
    it('should batch large embedding requests', async () => {
      const texts = new Array(200).fill('test text');
      
      const OpenAI = await import('openai');
      const mockOpenAI = vi.mocked(OpenAI.default);
      const instance = new mockOpenAI();
      
      // Mock multiple batch responses
      for (let i = 0; i < 4; i++) {
        vi.mocked(instance.embeddings.create).mockResolvedValueOnce({
          data: new Array(50).fill({ embedding: new Array(3072).fill(0.1) })
        } as any);
      }

      await generateEmbeddings(texts);
      
      expect(instance.embeddings.create).toHaveBeenCalledTimes(4);
    });

    it('should process chunk storage in batches', async () => {
      const chunks: DocumentChunk[] = new Array(100).fill(null).map((_, i) => ({
        id: `chunk-${i}`,
        content: `Content ${i}`,
        metadata: {
          id: `chunk-${i}`,
          type: 'document',
          content: `Content ${i}`,
          source: 'test.py',
          timestamp: Date.now()
        },
        startIndex: i * 10,
        endIndex: (i + 1) * 10
      }));

      await embedAndStoreChunks(chunks);

      // Should process in batches of 50
      const OpenAI = await import('openai');
      const mockOpenAI = vi.mocked(OpenAI.default);
      const instance = new mockOpenAI();
      expect(instance.embeddings.create).toHaveBeenCalledTimes(2);
    });
  });
});