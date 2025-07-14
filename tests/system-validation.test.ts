import { describe, it, expect } from 'vitest';

describe('System Validation', () => {
  it('should have all required environment variables', () => {
    expect(process.env.OPENAI_API_KEY).toBeDefined();
    expect(process.env.PINECONE_API_KEY).toBeDefined();
    
    // Verify keys are not the test defaults
    expect(process.env.OPENAI_API_KEY).not.toBe('test-openai-key');
    expect(process.env.PINECONE_API_KEY).not.toBe('test-pinecone-key');
  });

  it('should validate Pinecone configuration', async () => {
    const { VECTOR_DIMENSION, INDEXES } = await import('@/lib/pinecone');
    
    expect(VECTOR_DIMENSION).toBe(3072);
    expect(INDEXES.DOCUMENTS).toBe('n8n');
    expect(INDEXES.CODE).toBe('n8n');
    expect(INDEXES.QA).toBe('n8n');
  });

  it('should validate embedding configuration', async () => {
    // Test that we can import the embedding functions
    const embeddings = await import('@/lib/embeddings');
    
    expect(embeddings.generateEmbedding).toBeDefined();
    expect(embeddings.searchSimilarContent).toBeDefined();
    expect(embeddings.hybridSearch).toBeDefined();
    expect(embeddings.getRelevantContext).toBeDefined();
  });

  it('should validate agent system', async () => {
    const { 
      OrchestratorAgent, 
      WriterAgent, 
      CriticAgent, 
      RouterAgent, 
      AnswerAgent 
    } = await import('@/lib/agents');
    
    // Test agent instantiation
    expect(() => new OrchestratorAgent()).not.toThrow();
    expect(() => new WriterAgent()).not.toThrow();
    expect(() => new CriticAgent()).not.toThrow();
    expect(() => new RouterAgent()).not.toThrow();
    expect(() => new AnswerAgent()).not.toThrow();
  });

  it('should validate chunking system', async () => {
    const { chunkPythonCode, chunkDocumentation, chunkQA } = await import('@/lib/chunking');
    
    // Test simple chunking
    const pythonChunks = chunkPythonCode('def test(): pass', 'test.py');
    expect(pythonChunks).toHaveLength(1);
    expect(pythonChunks[0].metadata.type).toBe('code');
    
    const docChunks = chunkDocumentation('Test documentation', 'test.md');
    expect(docChunks).toHaveLength(1);
    expect(docChunks[0].metadata.type).toBe('document');
    
    const qaChunks = chunkQA('What is this?', 'A test.', 'test');
    expect(qaChunks).toHaveLength(1);
    expect(qaChunks[0].metadata.type).toBe('qa');
  });

  it('should validate system is ready for production', () => {
    // Check that we're not in test-only mode
    expect(process.env.NODE_ENV).toBeDefined();
    
    // Verify required packages are available
    expect(() => require('@pinecone-database/pinecone')).not.toThrow();
    expect(() => require('openai')).not.toThrow();
  });
});