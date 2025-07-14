import OpenAI from 'openai';
import { DocumentChunk } from './chunking';
import { upsertVector, searchVectors } from './pinecone';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Embedding model configuration
const EMBEDDING_MODEL = 'text-embedding-3-large';
const _EMBEDDING_DIMENSION = 3072;
const BATCH_SIZE = 50; // Reduced batch size for larger embeddings

// Generate embedding for a single text
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      encoding_format: 'float',
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

// Generate embeddings for multiple texts in batches
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
        encoding_format: 'float',
      });
      
      const batchEmbeddings = response.data.map(item => item.embedding);
      embeddings.push(...batchEmbeddings);
    } catch (error) {
      console.error(`Error generating embeddings for batch ${i}:`, error);
      throw error;
    }
  }
  
  return embeddings;
}

// Embed and store document chunks
export async function embedAndStoreChunks(
  chunks: DocumentChunk[],
  onProgress?: (progress: number) => void
): Promise<void> {
  const total = chunks.length;
  let processed = 0;
  
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(chunk => chunk.content);
    
    try {
      const embeddings = await generateEmbeddings(texts);
      
      // Store embeddings in Pinecone
      const storePromises = batch.map(async (chunk, index) => {
        const indexName = getIndexForChunkType(chunk.metadata.type);
        await upsertVector(indexName, embeddings[index], chunk.metadata);
      });
      
      await Promise.all(storePromises);
      
      processed += batch.length;
      if (onProgress) {
        onProgress(processed / total);
      }
    } catch (error) {
      console.error(`Error processing batch ${i}:`, error);
      throw error;
    }
  }
}

// Get appropriate index for chunk type (all use n8n index)
function getIndexForChunkType(type: string): string {
  return 'n8n'; // All content types use the same index
}

// Search for similar content
export async function searchSimilarContent(
  query: string,
  type: 'document' | 'code' | 'qa' | 'kpi' = 'document',
  topK: number = 5,
  filter?: Record<string, unknown>
): Promise<Array<{ id: string; score: number; content: string; source: string; metadata?: Record<string, unknown> }>> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const indexName = getIndexForChunkType(type);
    
    const results = await searchVectors(indexName, queryEmbedding, topK, filter);
    
    return results.map(result => ({
      id: result.id || '',
      score: result.score || 0,
      content: (result.metadata?.content as string) || '',
      source: (result.metadata?.source as string) || '',
      metadata: result.metadata as Record<string, unknown>
    }));
  } catch (error) {
    console.error('Error searching similar content:', error);
    throw error;
  }
}

// Hybrid search combining multiple content types
export async function hybridSearch(
  query: string,
  options: {
    includeDocuments?: boolean;
    includeCode?: boolean;
    includeQA?: boolean;
    includeKPIs?: boolean;
    topK?: number;
    filter?: Record<string, unknown>;
  } = {}
): Promise<{
  documents: Array<{ id: string; score: number; content: string; source: string; metadata?: Record<string, unknown> }>;
  code: Array<{ id: string; score: number; content: string; source: string; metadata?: Record<string, unknown> }>;
  qa: Array<{ id: string; score: number; content: string; source: string; metadata?: Record<string, unknown> }>;
  kpis: Array<{ id: string; score: number; content: string; source: string; metadata?: Record<string, unknown> }>;
  combined: Array<{ id: string; score: number; content: string; source: string; metadata?: Record<string, unknown> }>;
}> {
  const {
    includeDocuments = true,
    includeCode = true,
    includeQA = true,
    includeKPIs = true,
    topK = 5,
    filter
  } = options;
  
  const searchPromises: Promise<Array<{ id: string; score: number; content: string; source: string; metadata?: Record<string, unknown> }>>[] = [];
  const types: string[] = [];
  
  if (includeDocuments) {
    searchPromises.push(searchSimilarContent(query, 'document', topK, filter));
    types.push('document');
  }
  
  if (includeCode) {
    searchPromises.push(searchSimilarContent(query, 'code', topK, filter));
    types.push('code');
  }
  
  if (includeQA) {
    searchPromises.push(searchSimilarContent(query, 'qa', topK, filter));
    types.push('qa');
  }
  
  if (includeKPIs) {
    searchPromises.push(searchSimilarContent(query, 'kpi', topK, filter));
    types.push('kpi');
  }
  
  const results = await Promise.all(searchPromises);
  
  const documents = types.includes('document') ? results[types.indexOf('document')] : [];
  const code = types.includes('code') ? results[types.indexOf('code')] : [];
  const qa = types.includes('qa') ? results[types.indexOf('qa')] : [];
  const kpis = types.includes('kpi') ? results[types.indexOf('kpi')] : [];
  
  // Combine and sort by score
  const combined = [...documents, ...code, ...qa, ...kpis]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, topK);
  
  return {
    documents,
    code,
    qa,
    kpis,
    combined
  };
}

// Get relevant context for a query
export async function getRelevantContext(
  query: string,
  maxTokens: number = 4000,
  options: {
    includeDocuments?: boolean;
    includeCode?: boolean;
    includeQA?: boolean;
    minScore?: number;
  } = {}
): Promise<string> {
  const {
    includeDocuments = true,
    includeCode = true,
    includeQA = true,
    minScore = 0.7
  } = options;
  
  const searchResults = await hybridSearch(query, {
    includeDocuments,
    includeCode,
    includeQA,
    topK: 20 // Get more results to filter by score
  });
  
  // Filter by minimum score and estimate token count
  const relevantResults = searchResults.combined
    .filter(result => (result.score || 0) >= minScore)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  
  let contextText = '';
  let estimatedTokens = 0;
  
  for (const result of relevantResults) {
    const content = result.content;
    const estimatedContentTokens = Math.ceil(content.length / 4); // Rough token estimation
    
    if (estimatedTokens + estimatedContentTokens > maxTokens) {
      break;
    }
    
    contextText += `\n--- ${result.metadata?.type || 'content'} (score: ${result.score?.toFixed(2)}) ---\n`;
    contextText += content;
    contextText += '\n';
    
    estimatedTokens += estimatedContentTokens;
  }
  
  return contextText.trim();
}

// Batch processing for large document ingestion
export async function batchEmbedAndStore(
  allChunks: DocumentChunk[],
  batchSize: number = 50,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const totalBatches = Math.ceil(allChunks.length / batchSize);
  
  for (let i = 0; i < totalBatches; i++) {
    const batch = allChunks.slice(i * batchSize, (i + 1) * batchSize);
    
    await embedAndStoreChunks(batch);
    
    if (onProgress) {
      onProgress(i + 1, totalBatches);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}