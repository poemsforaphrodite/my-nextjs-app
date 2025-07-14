import { VectorMetadata } from './pinecone';

export interface ChunkOptions {
  maxChunkSize: number;
  overlapSize: number;
  preserveStructure: boolean;
  chunkType: 'document' | 'code' | 'qa' | 'kpi';
}

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: VectorMetadata;
  startIndex: number;
  endIndex: number;
}

// Default chunking options
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChunkSize: 1000,
  overlapSize: 200,
  preserveStructure: true,
  chunkType: 'document'
};

// Generate unique chunk ID
function generateChunkId(source: string, index: number, type: string): string {
  return `${type}-${source}-${index}-${Date.now()}`;
}

// Generic text chunking with overlap
export function chunkText(
  text: string,
  options: Partial<ChunkOptions> = {}
): DocumentChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const chunks: DocumentChunk[] = [];
  
  if (text.length <= opts.maxChunkSize) {
    return [{
      id: generateChunkId('text', 0, opts.chunkType),
      content: text,
      metadata: {
        id: generateChunkId('text', 0, opts.chunkType),
        type: opts.chunkType,
        content: text,
        source: 'text',
        timestamp: Date.now()
      },
      startIndex: 0,
      endIndex: text.length
    }];
  }
  
  let startIndex = 0;
  let chunkIndex = 0;
  
  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + opts.maxChunkSize, text.length);
    const chunkContent = text.slice(startIndex, endIndex);
    
    const chunk: DocumentChunk = {
      id: generateChunkId('text', chunkIndex, opts.chunkType),
      content: chunkContent,
      metadata: {
        id: generateChunkId('text', chunkIndex, opts.chunkType),
        type: opts.chunkType,
        content: chunkContent,
        source: 'text',
        timestamp: Date.now(),
        chunkIndex,
        totalChunks: Math.ceil(text.length / (opts.maxChunkSize - opts.overlapSize))
      },
      startIndex,
      endIndex
    };
    
    chunks.push(chunk);
    
    // Move to next chunk with overlap
    startIndex = endIndex - opts.overlapSize;
    if (startIndex >= text.length) break;
    
    chunkIndex++;
  }
  
  return chunks;
}

// Python code-specific chunking
export function chunkPythonCode(
  code: string,
  filename: string,
  options: Partial<ChunkOptions> = {}
): DocumentChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options, chunkType: 'code' as const };
  const chunks: DocumentChunk[] = [];
  
  // Split by classes and functions first
  const lines = code.split('\n');
  const codeBlocks: { content: string; type: string; name: string; startLine: number }[] = [];
  
  let currentBlock = '';
  let blockType = 'module';
  let blockName = 'module';
  let blockStartLine = 0;
  const _currentIndent = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Detect function or class definitions
    if (trimmedLine.startsWith('def ') || trimmedLine.startsWith('class ')) {
      // Save previous block if it exists
      if (currentBlock.trim()) {
        codeBlocks.push({
          content: currentBlock,
          type: blockType,
          name: blockName,
          startLine: blockStartLine
        });
      }
      
      // Start new block
      currentBlock = line + '\n';
      blockType = trimmedLine.startsWith('def ') ? 'function' : 'class';
      blockName = trimmedLine.split(' ')[1].split('(')[0].split(':')[0];
      blockStartLine = i;
      const _currentIndent = line.length - line.trimStart().length;
    } else {
      currentBlock += line + '\n';
    }
  }
  
  // Add final block
  if (currentBlock.trim()) {
    codeBlocks.push({
      content: currentBlock,
      type: blockType,
      name: blockName,
      startLine: blockStartLine
    });
  }
  
  // Convert code blocks to chunks
  let chunkIndex = 0;
  for (const block of codeBlocks) {
    if (block.content.length <= opts.maxChunkSize) {
      // Block fits in one chunk
      chunks.push({
        id: generateChunkId(filename, chunkIndex, 'code'),
        content: block.content,
        metadata: {
          id: generateChunkId(filename, chunkIndex, 'code'),
          type: 'code',
          content: block.content,
          source: filename,
          timestamp: Date.now(),
          blockType: block.type,
          blockName: block.name,
          startLine: block.startLine,
          language: 'python'
        },
        startIndex: 0,
        endIndex: block.content.length
      });
      chunkIndex++;
    } else {
      // Split large blocks
      const subChunks = chunkText(block.content, { ...opts, chunkType: 'code' });
      subChunks.forEach((subChunk, subIndex) => {
        subChunk.id = generateChunkId(filename, chunkIndex, 'code');
        subChunk.metadata.id = subChunk.id;
        subChunk.metadata.source = filename;
        subChunk.metadata.blockType = block.type;
        subChunk.metadata.blockName = block.name;
        subChunk.metadata.startLine = block.startLine;
        subChunk.metadata.language = 'python';
        subChunk.metadata.subChunkIndex = subIndex;
        chunks.push(subChunk);
        chunkIndex++;
      });
    }
  }
  
  return chunks;
}

// Documentation-specific chunking
export function chunkDocumentation(
  content: string,
  source: string,
  options: Partial<ChunkOptions> = {}
): DocumentChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options, chunkType: 'document' as const };
  
  // Split by sections if markdown
  if (source.endsWith('.md')) {
    return chunkMarkdown(content, source, opts);
  }
  
  // Split by paragraphs for other documents
  const paragraphs = content.split(/\n\s*\n/);
  const chunks: DocumentChunk[] = [];
  let currentChunk = '';
  let chunkIndex = 0;
  
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length <= opts.maxChunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    } else {
      // Save current chunk
      if (currentChunk) {
        chunks.push({
          id: generateChunkId(source, chunkIndex, 'document'),
          content: currentChunk,
          metadata: {
            id: generateChunkId(source, chunkIndex, 'document'),
            type: 'document',
            content: currentChunk,
            source,
            timestamp: Date.now(),
            chunkIndex
          },
          startIndex: 0,
          endIndex: currentChunk.length
        });
        chunkIndex++;
      }
      
      // Start new chunk
      currentChunk = paragraph;
    }
  }
  
  // Add final chunk
  if (currentChunk) {
    chunks.push({
      id: generateChunkId(source, chunkIndex, 'document'),
      content: currentChunk,
      metadata: {
        id: generateChunkId(source, chunkIndex, 'document'),
        type: 'document',
        content: currentChunk,
        source,
        timestamp: Date.now(),
        chunkIndex
      },
      startIndex: 0,
      endIndex: currentChunk.length
    });
  }
  
  return chunks;
}

// Markdown-specific chunking
function chunkMarkdown(
  content: string,
  source: string,
  options: ChunkOptions
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const sections = content.split(/^(#{1,6})\s/m);
  let chunkIndex = 0;
  
  for (let i = 0; i < sections.length; i += 2) {
    const sectionContent = sections[i];
    const headerLevel = sections[i + 1];
    
    if (sectionContent && sectionContent.trim()) {
      const fullSection = headerLevel ? `${headerLevel} ${sectionContent}` : sectionContent;
      
      if (fullSection.length <= options.maxChunkSize) {
        chunks.push({
          id: generateChunkId(source, chunkIndex, 'document'),
          content: fullSection,
          metadata: {
            id: generateChunkId(source, chunkIndex, 'document'),
            type: 'document',
            content: fullSection,
            source,
            timestamp: Date.now(),
            chunkIndex,
            sectionType: 'markdown',
            headerLevel: headerLevel ? headerLevel.length : 0
          },
          startIndex: 0,
          endIndex: fullSection.length
        });
        chunkIndex++;
      } else {
        // Split large sections
        const subChunks = chunkText(fullSection, options);
        subChunks.forEach((subChunk, subIndex) => {
          subChunk.id = generateChunkId(source, chunkIndex, 'document');
          subChunk.metadata.id = subChunk.id;
          subChunk.metadata.source = source;
          subChunk.metadata.sectionType = 'markdown';
          subChunk.metadata.headerLevel = headerLevel ? headerLevel.length : 0;
          subChunk.metadata.subChunkIndex = subIndex;
          chunks.push(subChunk);
          chunkIndex++;
        });
      }
    }
  }
  
  return chunks;
}

// Q&A specific chunking
export function chunkQA(
  question: string,
  answer: string,
  source: string,
  options: Partial<ChunkOptions> = {}
): DocumentChunk[] {
  const _opts = { ...DEFAULT_CHUNK_OPTIONS, ...options, chunkType: 'qa' as const };
  const qaContent = `Question: ${question}\n\nAnswer: ${answer}`;
  
  return [{
    id: generateChunkId(source, 0, 'qa'),
    content: qaContent,
    metadata: {
      id: generateChunkId(source, 0, 'qa'),
      type: 'qa',
      content: qaContent,
      source,
      timestamp: Date.now(),
      question,
      answer,
      qaType: 'user-generated'
    },
    startIndex: 0,
    endIndex: qaContent.length
  }];
}

// KPI-specific chunking
export function chunkKPI(
  content: string,
  source: string,
  options: Partial<ChunkOptions> = {}
): DocumentChunk[] {
  const _opts = { ...DEFAULT_CHUNK_OPTIONS, ...options, chunkType: 'kpi' as const };
  
  try {
    // Parse KPI content as JSON array
    const kpis = JSON.parse(content);
    const chunks: DocumentChunk[] = [];
    
    if (Array.isArray(kpis)) {
      kpis.forEach((kpi, index) => {
        const kpiContent = `KPI: ${kpi.name}
Definition: ${kpi.definition}
Calculation Logic: ${kpi.calculationLogic}
Business Purpose: ${kpi.businessPurpose}
Data Source: ${kpi.dataSource}
Frequency: ${kpi.frequency}
Owner: ${kpi.owner}
Tags: ${kpi.tags?.join(', ') || 'N/A'}`;

        chunks.push({
          id: generateChunkId(source, index, 'kpi'),
          content: kpiContent,
          metadata: {
            id: generateChunkId(source, index, 'kpi'),
            type: 'kpi',
            content: kpiContent,
            source,
            timestamp: Date.now(),
            kpiName: kpi.name,
            kpiDefinition: kpi.definition,
            calculationLogic: kpi.calculationLogic,
            businessPurpose: kpi.businessPurpose,
            dataSource: kpi.dataSource,
            frequency: kpi.frequency,
            owner: kpi.owner,
            tags: kpi.tags || [],
            kpiIndex: index
          },
          startIndex: 0,
          endIndex: kpiContent.length
        });
      });
    } else {
      // Single KPI object
      const kpiContent = `KPI: ${kpis.name}
Definition: ${kpis.definition}
Calculation Logic: ${kpis.calculationLogic}
Business Purpose: ${kpis.businessPurpose}
Data Source: ${kpis.dataSource}
Frequency: ${kpis.frequency}
Owner: ${kpis.owner}
Tags: ${kpis.tags?.join(', ') || 'N/A'}`;

      chunks.push({
        id: generateChunkId(source, 0, 'kpi'),
        content: kpiContent,
        metadata: {
          id: generateChunkId(source, 0, 'kpi'),
          type: 'kpi',
          content: kpiContent,
          source,
          timestamp: Date.now(),
          kpiName: kpis.name,
          kpiDefinition: kpis.definition,
          calculationLogic: kpis.calculationLogic,
          businessPurpose: kpis.businessPurpose,
          dataSource: kpis.dataSource,
          frequency: kpis.frequency,
          owner: kpis.owner,
          tags: kpis.tags || [],
          kpiIndex: 0
        },
        startIndex: 0,
        endIndex: kpiContent.length
      });
    }
    
    return chunks;
  } catch (error) {
    console.error('Error parsing KPI content:', error);
    // Fallback to text chunking
    return [{
      id: generateChunkId(source, 0, 'kpi'),
      content,
      metadata: {
        id: generateChunkId(source, 0, 'kpi'),
        type: 'kpi',
        content,
        source,
        timestamp: Date.now(),
        parseError: true
      },
      startIndex: 0,
      endIndex: content.length
    }];
  }
}