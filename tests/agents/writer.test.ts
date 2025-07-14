import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WriterAgent, Documentation, DocumentationInput } from '@/lib/agents/writer';

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn()
      }
    }
  }))
}));

// Mock embeddings
vi.mock('@/lib/embeddings', () => ({
  getRelevantContext: vi.fn().mockResolvedValue('Mock RAG context with relevant examples')
}));

describe('WriterAgent', () => {
  let writerAgent: WriterAgent;
  let mockDocumentation: Documentation;
  let documentationInput: DocumentationInput;

  beforeEach(() => {
    writerAgent = new WriterAgent();
    
    mockDocumentation = {
      description: 'Test data processing pipeline for customer analytics',
      tableGrain: 'customer_id, date',
      dataSources: ['customer_data', 'transaction_history'],
      databricksTables: ['customer_analytics_output'],
      tableMetadata: [
        {
          tableName: 'customer_analytics_output',
          columns: [
            {
              name: 'customer_id',
              type: 'string',
              description: 'Unique identifier for customer'
            },
            {
              name: 'total_spend',
              type: 'decimal',
              description: 'Total customer spending amount'
            }
          ]
        }
      ],
      integratedRules: ['Customer must have at least one transaction', 'Exclude test customers']
    };

    documentationInput = {
      pythonCode: `
import pandas as pd
from pyspark.sql import SparkSession

def process_customer_data(df):
    """Process customer transaction data."""
    return df.groupBy('customer_id').agg(
        sum('amount').alias('total_spend'),
        count('transaction_id').alias('transaction_count')
    )

spark = SparkSession.builder.appName('CustomerAnalytics').getOrCreate()
df = spark.read.table('raw.customer_transactions')
result = process_customer_data(df)
result.write.mode('overwrite').saveAsTable('analytics.customer_summary')
      `,
      filename: 'customer_analytics.py'
    };

    // Mock OpenAI response
    const mockOpenAI = vi.mocked(writerAgent.openai);
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(mockDocumentation) } }]
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(writerAgent.config.name).toBe('writer');
      expect(writerAgent.config.enableRAG).toBe(true);
      expect(writerAgent.config.ragOptions?.includeDocuments).toBe(true);
      expect(writerAgent.config.ragOptions?.includeCode).toBe(true);
      expect(writerAgent.config.ragOptions?.includeQA).toBe(true);
    });

    it('should have appropriate model settings', () => {
      expect(writerAgent.config.temperature).toBe(0.3);
      expect(writerAgent.config.maxTokens).toBe(4000);
    });
  });

  describe('documentation generation', () => {
    it('should generate documentation from Python code', async () => {
      const result = await writerAgent.execute(documentationInput);
      
      expect(result).toEqual(mockDocumentation);
      expect(result.description).toContain('Test data processing pipeline');
      expect(result.dataSources).toContain('customer_data');
      expect(result.tableMetadata).toHaveLength(1);
    });

    it('should include RAG context in generation', async () => {
      await writerAgent.execute(documentationInput);
      
      // Verify RAG context was retrieved
      const { getRelevantContext } = await import('@/lib/embeddings');
      expect(getRelevantContext).toHaveBeenCalledWith(
        expect.stringContaining('customer_analytics.py'),
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should handle Excel context', async () => {
      const inputWithExcel = {
        ...documentationInput,
        excelContext: 'Customer data schema: customer_id, name, email, signup_date'
      };

      const result = await writerAgent.execute(inputWithExcel);
      expect(result).toEqual(mockDocumentation);
    });

    it('should handle existing documentation', async () => {
      const inputWithExisting = {
        ...documentationInput,
        existingDocs: 'Previous version: Basic customer processing without aggregations'
      };

      const result = await writerAgent.execute(inputWithExisting);
      expect(result).toEqual(mockDocumentation);
    });
  });

  describe('documentation validation', () => {
    it('should validate required fields', async () => {
      const invalidDoc = { description: 'Test' }; // Missing required fields
      
      const mockOpenAI = vi.mocked(writerAgent.openai);
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(invalidDoc) } }]
      } as any);

      await expect(writerAgent.execute(documentationInput)).rejects.toThrow(
        'Missing required field'
      );
    });

    it('should validate array fields', async () => {
      const invalidDoc = {
        ...mockDocumentation,
        dataSources: 'not an array' // Should be array
      };
      
      const mockOpenAI = vi.mocked(writerAgent.openai);
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(invalidDoc) } }]
      } as any);

      await expect(writerAgent.execute(documentationInput)).rejects.toThrow(
        'dataSources must be an array'
      );
    });

    it('should validate table metadata structure', async () => {
      const invalidDoc = {
        ...mockDocumentation,
        tableMetadata: [
          {
            tableName: 'test',
            columns: [
              { name: 'col1' } // Missing type and description
            ]
          }
        ]
      };
      
      const mockOpenAI = vi.mocked(writerAgent.openai);
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(invalidDoc) } }]
      } as any);

      await expect(writerAgent.execute(documentationInput)).rejects.toThrow(
        'Invalid column structure'
      );
    });
  });

  describe('refinement functionality', () => {
    it('should refine documentation based on feedback', async () => {
      const refinementInput = {
        feedback: {
          overallScore: 6,
          needsImprovement: true,
          suggestions: ['Add more detail to column descriptions', 'Include data quality rules']
        },
        previousDraft: mockDocumentation,
        originalInput: documentationInput
      };

      const improvedDoc = {
        ...mockDocumentation,
        description: 'Enhanced test data processing pipeline for customer analytics with improved detail'
      };

      const mockOpenAI = vi.mocked(writerAgent.openai);
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(improvedDoc) } }]
      } as any);

      // Test through the message interface since refineDocumentation is private
      const message = {
        id: 'test-msg',
        from: 'orchestrator',
        to: 'writer',
        type: 'request' as const,
        content: {
          action: 'refine_documentation',
          input: refinementInput,
          workflowId: 'test-workflow',
          stepId: 'refine-step'
        },
        timestamp: Date.now()
      };

      const sendMessageSpy = vi.spyOn(writerAgent, 'sendMessage').mockResolvedValue();
      
      await writerAgent.receiveMessage(message);
      
      expect(sendMessageSpy).toHaveBeenCalledWith(
        'orchestrator',
        'response',
        expect.objectContaining({
          description: expect.stringContaining('Enhanced')
        }),
        { stepId: 'refine-step' }
      );
    });
  });

  describe('streaming generation', () => {
    it('should generate streaming documentation', async () => {
      let streamedTokens = '';
      const onToken = (token: string) => {
        streamedTokens += token;
      };

      // Mock streaming response
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          const chunks = JSON.stringify(mockDocumentation).split('');
          for (const chunk of chunks) {
            yield { choices: [{ delta: { content: chunk } }] };
          }
        }
      };

      const mockOpenAI = vi.mocked(writerAgent.openai);
      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockStream as any);

      const result = await writerAgent.generateStreamingDocumentation(documentationInput, onToken);
      
      expect(result).toEqual(mockDocumentation);
      expect(streamedTokens).toBe(JSON.stringify(mockDocumentation));
    });
  });

  describe('message handling', () => {
    it('should handle generate_documentation action', async () => {
      const message = {
        id: 'test-msg',
        from: 'orchestrator',
        to: 'writer',
        type: 'request' as const,
        content: {
          action: 'generate_documentation',
          input: documentationInput,
          workflowId: 'test-workflow',
          stepId: 'generate-step'
        },
        timestamp: Date.now()
      };

      const sendMessageSpy = vi.spyOn(writerAgent, 'sendMessage').mockResolvedValue();
      
      await writerAgent.receiveMessage(message);
      
      expect(sendMessageSpy).toHaveBeenCalledWith(
        'orchestrator',
        'response',
        mockDocumentation,
        { stepId: 'generate-step' }
      );
    });

    it('should handle refine_documentation action', async () => {
      const refinementInput = {
        feedback: { needsImprovement: true, suggestions: ['Improve clarity'] },
        previousDraft: mockDocumentation,
        originalInput: documentationInput
      };

      const message = {
        id: 'test-msg',
        from: 'orchestrator',
        to: 'writer',
        type: 'request' as const,
        content: {
          action: 'refine_documentation',
          input: refinementInput,
          workflowId: 'test-workflow',
          stepId: 'refine-step'
        },
        timestamp: Date.now()
      };

      const sendMessageSpy = vi.spyOn(writerAgent, 'sendMessage').mockResolvedValue();
      
      await writerAgent.receiveMessage(message);
      
      expect(sendMessageSpy).toHaveBeenCalledWith(
        'orchestrator',
        'response',
        expect.any(Object),
        { stepId: 'refine-step' }
      );
    });

    it('should handle unknown actions', async () => {
      const message = {
        id: 'test-msg',
        from: 'orchestrator',
        to: 'writer',
        type: 'request' as const,
        content: {
          action: 'unknown_action',
          input: {},
          stepId: 'test-step'
        },
        timestamp: Date.now()
      };

      const sendMessageSpy = vi.spyOn(writerAgent, 'sendMessage').mockResolvedValue();
      
      await writerAgent.receiveMessage(message);
      
      expect(sendMessageSpy).toHaveBeenCalledWith(
        'orchestrator',
        'response',
        expect.objectContaining({
          error: 'Unknown action: unknown_action'
        }),
        { stepId: 'test-step' }
      );
    });
  });

  describe('error handling', () => {
    it('should handle JSON parsing errors', async () => {
      const mockOpenAI = vi.mocked(writerAgent.openai);
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Invalid JSON response' } }]
      } as any);

      await expect(writerAgent.execute(documentationInput)).rejects.toThrow(
        'Failed to parse documentation'
      );
    });

    it('should handle OpenAI API errors', async () => {
      const mockOpenAI = vi.mocked(writerAgent.openai);
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API Error'));

      await expect(writerAgent.execute(documentationInput)).rejects.toThrow('API Error');
    });
  });

  describe('prompt building', () => {
    it('should build comprehensive prompts', async () => {
      const input = {
        ...documentationInput,
        excelContext: 'Excel schema info',
        existingDocs: 'Previous documentation',
        userPreferences: { style: 'detailed' }
      };

      await writerAgent.execute(input);

      const mockOpenAI = vi.mocked(writerAgent.openai);
      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content;

      expect(userMessage).toContain('Excel Context:');
      expect(userMessage).toContain('Existing Documentation:');
      expect(userMessage).toContain('User Preferences:');
      expect(userMessage).toContain('Retrieved Context');
    });
  });
});