import { describe, it, expect } from 'vitest';
import { 
  chunkText, 
  chunkPythonCode, 
  chunkDocumentation, 
  chunkQA,
  DEFAULT_CHUNK_OPTIONS 
} from '@/lib/chunking';

describe('Chunking', () => {
  describe('chunkText', () => {
    it('should return single chunk for small text', () => {
      const text = 'Short text that fits in one chunk';
      const chunks = chunkText(text);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(text);
      expect(chunks[0].startIndex).toBe(0);
      expect(chunks[0].endIndex).toBe(text.length);
    });

    it('should split large text into multiple chunks with overlap', () => {
      const text = 'A'.repeat(2000); // Large text
      const chunks = chunkText(text, { maxChunkSize: 500, overlapSize: 100 });
      
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].content.length).toBe(500);
      expect(chunks[1].startIndex).toBe(400); // 500 - 100 overlap
    });

    it('should respect custom chunk options', () => {
      const text = 'X'.repeat(1500);
      const options = {
        maxChunkSize: 300,
        overlapSize: 50,
        preserveStructure: false,
        chunkType: 'document' as const
      };
      
      const chunks = chunkText(text, options);
      
      expect(chunks[0].content.length).toBe(300);
      expect(chunks[0].metadata.type).toBe('document');
    });

    it('should include metadata in chunks', () => {
      const text = 'Test text for metadata';
      const chunks = chunkText(text);
      
      expect(chunks[0].metadata).toBeDefined();
      expect(chunks[0].metadata.type).toBe('document');
      expect(chunks[0].metadata.content).toBe(text);
      expect(chunks[0].metadata.source).toBe('text');
      expect(typeof chunks[0].metadata.timestamp).toBe('number');
    });
  });

  describe('chunkPythonCode', () => {
    const pythonCode = `
import pandas as pd
from pyspark.sql import SparkSession

def process_data(df):
    """Process the dataframe."""
    return df.filter(df.status == 'active')

class DataProcessor:
    def __init__(self):
        self.spark = SparkSession.builder.getOrCreate()
    
    def transform(self, data):
        return data.groupBy('category').count()

# Main execution
if __name__ == "__main__":
    processor = DataProcessor()
    result = processor.transform(data)
    `;

    it('should identify and chunk functions and classes', () => {
      const chunks = chunkPythonCode(pythonCode, 'test.py');
      
      expect(chunks.length).toBeGreaterThan(1);
      
      // Should have chunks for different code blocks
      const functionChunk = chunks.find(c => c.metadata.blockType === 'function');
      const classChunk = chunks.find(c => c.metadata.blockType === 'class');
      
      expect(functionChunk).toBeDefined();
      expect(classChunk).toBeDefined();
      expect(functionChunk?.metadata.blockName).toBe('process_data');
      expect(classChunk?.metadata.blockName).toBe('DataProcessor');
    });

    it('should preserve code structure in metadata', () => {
      const chunks = chunkPythonCode(pythonCode, 'test.py');
      
      chunks.forEach(chunk => {
        expect(chunk.metadata.type).toBe('code');
        expect(chunk.metadata.source).toBe('test.py');
        expect(chunk.metadata.language).toBe('python');
        expect(typeof chunk.metadata.startLine).toBe('number');
      });
    });

    it('should handle large code blocks by splitting them', () => {
      const largeFunction = `
def very_large_function():
    """ ${'This is a very long docstring. '.repeat(50)} """
    ${'# Long comment line\n    '.repeat(100)}
    return result
      `;
      
      const chunks = chunkPythonCode(largeFunction, 'large.py', { maxChunkSize: 500 });
      
      // Should split large function into sub-chunks
      const functionChunks = chunks.filter(c => c.metadata.blockName === 'very_large_function');
      expect(functionChunks.length).toBeGreaterThan(1);
    });

    it('should handle module-level code', () => {
      const moduleCode = `
import os
import sys

# Configuration
CONFIG = {
    'debug': True,
    'port': 8080
}

print("Module loaded")
      `;
      
      const chunks = chunkPythonCode(moduleCode, 'module.py');
      
      const moduleChunk = chunks.find(c => c.metadata.blockType === 'module');
      expect(moduleChunk).toBeDefined();
    });
  });

  describe('chunkDocumentation', () => {
    it('should chunk markdown by sections', () => {
      const markdown = `
# Main Title

This is the introduction.

## Section 1

Content for section 1 with some details.

## Section 2

Content for section 2 with more information.

### Subsection 2.1

Detailed subsection content.
      `;
      
      const chunks = chunkDocumentation(markdown, 'doc.md');
      
      expect(chunks.length).toBeGreaterThan(1);
      
      // Check that sections are properly identified
      const mainSection = chunks.find(c => c.content.includes('# Main Title'));
      expect(mainSection).toBeDefined();
      expect(mainSection?.metadata.sectionType).toBe('markdown');
    });

    it('should chunk plain text by paragraphs', () => {
      const plainText = `
First paragraph with some content that describes the initial concept.

Second paragraph that continues the discussion with additional details and explanations.

Third paragraph that concludes the document with final thoughts and recommendations.
      `;
      
      const chunks = chunkDocumentation(plainText, 'doc.txt');
      
      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach(chunk => {
        expect(chunk.metadata.type).toBe('document');
        expect(chunk.metadata.source).toBe('doc.txt');
      });
    });

    it('should handle large documents by splitting', () => {
      const largeParagraph = 'This is a very long paragraph. '.repeat(100);
      const chunks = chunkDocumentation(largeParagraph, 'large.txt', { maxChunkSize: 500 });
      
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].content.length).toBeLessThanOrEqual(500);
    });

    it('should preserve markdown headers in metadata', () => {
      const markdown = `
## Important Section

This section contains important information about the system.
      `;
      
      const chunks = chunkDocumentation(markdown, 'doc.md');
      
      const sectionChunk = chunks.find(c => c.content.includes('Important Section'));
      expect(sectionChunk?.metadata.headerLevel).toBe(2);
    });
  });

  describe('chunkQA', () => {
    it('should create QA chunks with question and answer', () => {
      const question = 'What is the purpose of this function?';
      const answer = 'This function processes customer data and calculates metrics.';
      
      const chunks = chunkQA(question, answer, 'qa-source');
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toContain(question);
      expect(chunks[0].content).toContain(answer);
      expect(chunks[0].metadata.type).toBe('qa');
      expect(chunks[0].metadata.question).toBe(question);
      expect(chunks[0].metadata.answer).toBe(answer);
    });

    it('should format QA content properly', () => {
      const question = 'How do I configure the database?';
      const answer = 'Set the DATABASE_URL environment variable.';
      
      const chunks = chunkQA(question, answer, 'config-qa');
      
      expect(chunks[0].content).toBe(`Question: ${question}\n\nAnswer: ${answer}`);
    });

    it('should include QA-specific metadata', () => {
      const chunks = chunkQA('Q', 'A', 'test');
      
      expect(chunks[0].metadata.qaType).toBe('user-generated');
      expect(chunks[0].metadata.source).toBe('test');
    });
  });

  describe('chunk ID generation', () => {
    it('should generate unique IDs for chunks', () => {
      const text = 'Test text';
      const chunks1 = chunkText(text);
      const chunks2 = chunkText(text);
      
      expect(chunks1[0].id).not.toBe(chunks2[0].id);
    });

    it('should include chunk type in ID', () => {
      const codeChunks = chunkPythonCode('def test(): pass', 'test.py');
      const docChunks = chunkDocumentation('Test doc', 'test.md');
      const qaChunks = chunkQA('Q?', 'A.', 'test');
      
      expect(codeChunks[0].id).toContain('code');
      expect(docChunks[0].id).toContain('document');
      expect(qaChunks[0].id).toContain('qa');
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const chunks = chunkText('');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('');
    });

    it('should handle whitespace-only input', () => {
      const chunks = chunkText('   \n  \t  ');
      expect(chunks).toHaveLength(1);
    });

    it('should handle code with no functions or classes', () => {
      const simpleCode = 'print("Hello World")';
      const chunks = chunkPythonCode(simpleCode, 'simple.py');
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].metadata.blockType).toBe('module');
    });

    it('should handle malformed markdown', () => {
      const malformedMd = '### Incomplete header\nNo closing content\n## Another';
      const chunks = chunkDocumentation(malformedMd, 'test.md');
      
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('metadata consistency', () => {
    it('should include timestamps in all chunks', () => {
      const codeChunks = chunkPythonCode('def test(): pass', 'test.py');
      const docChunks = chunkDocumentation('Test', 'test.md');
      const qaChunks = chunkQA('Q', 'A', 'test');
      
      [...codeChunks, ...docChunks, ...qaChunks].forEach(chunk => {
        expect(typeof chunk.metadata.timestamp).toBe('number');
        expect(chunk.metadata.timestamp).toBeLessThanOrEqual(Date.now());
      });
    });

    it('should maintain consistent ID format', () => {
      const chunks = chunkText('Test text');
      
      expect(chunks[0].id).toMatch(/^document-text-\d+-\d+$/);
      expect(chunks[0].metadata.id).toBe(chunks[0].id);
    });

    it('should preserve source information', () => {
      const filename = 'important-script.py';
      const chunks = chunkPythonCode('def func(): pass', filename);
      
      chunks.forEach(chunk => {
        expect(chunk.metadata.source).toBe(filename);
      });
    });
  });

  describe('chunk options', () => {
    it('should use default options when none provided', () => {
      const chunks = chunkText('Test');
      
      expect(chunks[0].metadata.type).toBe(DEFAULT_CHUNK_OPTIONS.chunkType);
    });

    it('should override default options', () => {
      const customOptions = {
        maxChunkSize: 100,
        overlapSize: 20,
        preserveStructure: false,
        chunkType: 'code' as const
      };
      
      const chunks = chunkText('Test text', customOptions);
      
      expect(chunks[0].metadata.type).toBe('code');
    });

    it('should validate chunk boundaries', () => {
      const text = 'ABCDEFGHIJ';
      const chunks = chunkText(text, { maxChunkSize: 5, overlapSize: 2 });
      
      expect(chunks[0].startIndex).toBe(0);
      expect(chunks[0].endIndex).toBe(5);
      expect(chunks[1].startIndex).toBe(3); // 5 - 2 overlap
    });
  });
});