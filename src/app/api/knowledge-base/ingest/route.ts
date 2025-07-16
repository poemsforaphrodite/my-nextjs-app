import { NextRequest, NextResponse } from 'next/server';
import { chunkPythonCode, chunkDocumentation, chunkQA, chunkKPI, DocumentChunk } from '@/lib/chunking';
import { embedAndStoreChunks } from '@/lib/embeddings';

export const maxDuration = 120; // 120 seconds for document processing

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      content, 
      filename, 
      contentType, 
      metadata = {},
      options = {} 
    } = body;

    // Validate required fields
    if (!content || !filename || !contentType) {
      return NextResponse.json(
        { error: 'Content, filename, and contentType are required' },
        { status: 400 }
      );
    }

    // Validate content type
    const validTypes = ['python', 'documentation', 'qa', 'kpi'];
    if (!validTypes.includes(contentType)) {
      return NextResponse.json(
        { error: `Invalid content type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if streaming is requested
    const wantsStreaming = request.headers.get('accept') === 'text/event-stream';

    if (wantsStreaming) {
      // Return streaming response
      return handleStreamingIngestion({
        documents: [{
          content,
          filename,
          contentType,
          metadata,
          options
        }]
      });
    } else {
      // Return regular JSON response
      const result = await processContent({
        content,
        filename,
        contentType,
        metadata,
        options
      });

      return NextResponse.json(result);
    }
  } catch (error) {
    console.error('Ingestion error:', error);
    return NextResponse.json(
      { error: 'Failed to ingest content' },
      { status: 500 }
    );
  }
}

// Process content for ingestion
async function processContent({
  content,
  filename,
  contentType,
  metadata,
  options
}: {
  content: string;
  filename: string;
  contentType: string;
  metadata: Record<string, unknown>;
  options: Record<string, unknown>;
}) {
  let chunks;

  // Chunk content based on type
  switch (contentType) {
    case 'python':
      chunks = chunkPythonCode(content, filename, options);
      break;
    
    case 'documentation':
      chunks = chunkDocumentation(content, filename, options);
      break;
    
    case 'qa':
      const { question, answer } = metadata as { question?: string; answer?: string };
      if (!question || !answer) {
        throw new Error('Question and answer are required for QA content');
      }
      chunks = chunkQA(question, answer, filename, options);
      break;
    
    case 'kpi':
      chunks = chunkKPI(content, filename, options);
      break;
    
    default:
      throw new Error(`Unsupported content type: ${contentType}`);
  }

  // Add additional metadata
  chunks.forEach(chunk => {
    chunk.metadata = {
      ...chunk.metadata,
      ...metadata,
      ingestionDate: new Date().toISOString(),
      contentType
    };
  });

  // Embed and store chunks
  await embedAndStoreChunks(chunks);

  return {
    success: true,
    filename,
    contentType,
    chunksProcessed: chunks.length,
    totalCharacters: content.length,
    metadata: {
      ...metadata,
      ingestionDate: new Date().toISOString(),
      contentType
    }
  };
}

// Handle streaming ingestion
async function handleStreamingIngestion(input: { documents: Array<{ content: string; filename: string; contentType: string; metadata: Record<string, unknown>; options: Record<string, unknown> }> }) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
    try {
      // Send initial status
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Starting content ingestion...',
          progress: 0
        })}\n\n`)
      );

      // Chunk content
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Chunking content...',
          progress: 0.2
        })}\n\n`)
      );

      const allChunks: DocumentChunk[] = [];
      
      // Process each document
      for (const doc of input.documents) {
        const { content, filename, contentType, metadata, options } = doc;
        let chunks;

        switch (contentType) {
          case 'python':
            chunks = chunkPythonCode(content, filename, options);
            break;
          
          case 'documentation':
            chunks = chunkDocumentation(content, filename, options);
            break;
          
          case 'qa':
            const { question, answer } = metadata as { question?: string; answer?: string };
            if (!question || !answer) {
              throw new Error('Question and answer are required for QA content');
            }
            chunks = chunkQA(question, answer, filename, options);
            break;
          
          case 'kpi':
            chunks = chunkKPI(content, filename, options);
            break;
        
          default:
            throw new Error(`Unsupported content type: ${contentType}`);
        }

        // Add metadata
        chunks.forEach(chunk => {
          chunk.metadata = {
            ...chunk.metadata,
            ...metadata,
            ingestionDate: new Date().toISOString(),
            contentType
          };
        });

        allChunks.push(...chunks);
      }

      // Send chunking complete
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: `Created ${allChunks.length} chunks`,
          progress: 0.4
        })}\n\n`)
      );

      // Embed and store with progress updates
      await embedAndStoreChunks(allChunks, (progress) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: 'progress',
            message: 'Embedding and storing chunks...',
            progress: 0.4 + (progress * 0.6)
          })}\n\n`)
        );
      });

      // Send final result
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'result',
          data: {
            success: true,
            documentsProcessed: input.documents.length,
            chunksProcessed: allChunks.length,
            totalCharacters: input.documents.reduce((total, doc) => total + doc.content.length, 0),
            metadata: {
              ingestionDate: new Date().toISOString(),
              processedDocuments: input.documents.map(doc => ({
                filename: doc.filename,
                contentType: doc.contentType
              }))
            }
          }
        })}\n\n`)
      );

      // End stream
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();

    } catch (error) {
      // Send error
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`)
      );
      controller.close();
    }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}