import { Pinecone } from '@pinecone-database/pinecone';

// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

// Index configurations
export const INDEXES = {
  DOCUMENTS: 'n8n',  // Using your existing index
  CODE: 'n8n',      // Using single index for all content types
  QA: 'n8n'         // Using single index for all content types
} as const;

// Vector dimensions for OpenAI text-embedding-3-large (3072 dimensions)
export const VECTOR_DIMENSION = 3072;

// Get or create index (using existing n8n index)
export async function getOrCreateIndex(indexName: string = 'n8n') {
  try {
    // Always use the existing n8n index
    const index = pinecone.index('n8n');
    return index;
  } catch (error) {
    console.error(`Error accessing index n8n:`, error);
    throw new Error(`Failed to access Pinecone index: ${error}`);
  }
}

// Initialize all indexes (using single n8n index)
export async function initializeIndexes() {
  const index = await getOrCreateIndex('n8n');
  
  return {
    documents: index,
    code: index,
    qa: index
  };
}

// Vector operations
export interface VectorMetadata {
  id: string;
  type: 'document' | 'code' | 'qa' | 'kpi';
  content: string;
  source: string;
  timestamp: number;
  [key: string]: unknown;
}

export async function upsertVector(
  indexName: string,
  vector: number[],
  metadata: VectorMetadata
) {
  const index = await getOrCreateIndex(indexName);
  
  await index.upsert([{
    id: metadata.id,
    values: vector,
    metadata: metadata as Record<string, string | number | boolean | string[]>
  }]);
}

export async function searchVectors(
  indexName: string,
  vector: number[],
  topK: number = 5,
  filter?: Record<string, unknown>
) {
  const index = await getOrCreateIndex(indexName);
  
  const results = await index.query({
    vector,
    topK,
    includeMetadata: true,
    filter
  });
  
  return results.matches || [];
}

export async function deleteVector(indexName: string, id: string) {
  const index = await getOrCreateIndex(indexName);
  await index.deleteOne(id);
}

// Search knowledge base for specific content
export async function searchKnowledgeBase(
  query: string,
  options: {
    filter?: Record<string, unknown>;
    topK?: number;
  } = {}
) {
  const { filter = {}, topK = 5 } = options;
  
  // For now, return a simple structure that matches the expected format
  // This would normally use embeddings to search, but for simplicity we'll use a basic structure
  const index = await getOrCreateIndex('n8n');
  
  try {
    // Since we don't have the vector for the query, we'll do a basic metadata search
    // In a real implementation, you'd embed the query first
    const results = await index.query({
      vector: new Array(VECTOR_DIMENSION).fill(0), // Dummy vector
      topK,
      includeMetadata: true,
      filter
    });
    
    return {
      matches: results.matches || []
    };
  } catch (error) {
    console.error('Knowledge base search error:', error);
    return { matches: [] };
  }
}

export default pinecone;