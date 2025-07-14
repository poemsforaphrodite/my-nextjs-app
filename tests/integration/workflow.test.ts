import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestratorAgent } from '@/lib/agents/orchestrator';
import { WriterAgent } from '@/lib/agents/writer';
import { CriticAgent } from '@/lib/agents/critic';
import { RouterAgent } from '@/lib/agents/router';
import { AnswerAgent } from '@/lib/agents/answer';
import { agentRegistry } from '@/lib/agents/base';

// Mock external dependencies
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn()
      }
    },
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(3072).fill(0.1) }]
      })
    }
  }))
}));

vi.mock('@/lib/pinecone', () => ({
  getOrCreateIndex: vi.fn().mockResolvedValue({
    upsert: vi.fn(),
    query: vi.fn().mockResolvedValue({
      matches: [
        {
          id: 'test-1',
          score: 0.95,
          metadata: {
            content: 'Relevant documentation content',
            type: 'document',
            source: 'test-doc.py'
          }
        }
      ]
    })
  }),
  upsertVector: vi.fn().mockResolvedValue(undefined),
  searchVectors: vi.fn().mockResolvedValue([]),
  initializeIndexes: vi.fn().mockResolvedValue({
    documents: {},
    code: {},
    qa: {}
  }),
  INDEXES: { DOCUMENTS: 'n8n', CODE: 'n8n', QA: 'n8n' }
}));

vi.mock('@/lib/embeddings', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(3072).fill(0.1)),
  embedAndStoreChunks: vi.fn().mockResolvedValue(undefined),
  getRelevantContext: vi.fn().mockResolvedValue('Mock relevant context'),
  hybridSearch: vi.fn().mockResolvedValue({
    documents: [],
    code: [],
    qa: [],
    combined: [
      {
        id: 'context-1',
        content: 'Relevant context content',
        score: 0.9,
        metadata: { type: 'document', source: 'context.py' }
      }
    ]
  })
}));

describe('Integration Tests', () => {
  let orchestrator: OrchestratorAgent;
  let writer: WriterAgent;
  let critic: CriticAgent;
  let router: RouterAgent;
  let answer: AnswerAgent;

  beforeEach(async () => {
    // Clear any existing agents
    vi.clearAllMocks();

    // Create fresh agent instances
    orchestrator = new OrchestratorAgent();
    writer = new WriterAgent();
    critic = new CriticAgent();
    router = new RouterAgent();
    answer = new AnswerAgent();

    // Register agents
    agentRegistry.register(orchestrator);
    agentRegistry.register(writer);
    agentRegistry.register(critic);
    agentRegistry.register(router);
    agentRegistry.register(answer);

    // Initialize agents
    const context = {
      sessionId: 'test-session',
      taskId: 'test-task',
      messages: [],
      sharedState: {}
    };

    await Promise.all([
      orchestrator.initialize(context),
      writer.initialize(context),
      critic.initialize(context),
      router.initialize(context),
      answer.initialize(context)
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Complete Documentation Generation Workflow', () => {
    const samplePythonCode = `
import pandas as pd
from pyspark.sql import SparkSession

def process_customer_data(df):
    """
    Process customer transaction data to calculate metrics.
    
    Args:
        df: Input DataFrame with customer transactions
        
    Returns:
        DataFrame with customer metrics
    """
    return df.groupBy('customer_id').agg(
        sum('amount').alias('total_spend'),
        count('transaction_id').alias('transaction_count'),
        avg('amount').alias('avg_transaction')
    ).filter(col('total_spend') > 0)

# Main processing
spark = SparkSession.builder.appName('CustomerAnalytics').getOrCreate()
transactions_df = spark.read.table('raw.customer_transactions')
customer_metrics = process_customer_data(transactions_df)
customer_metrics.write.mode('overwrite').saveAsTable('analytics.customer_summary')
    `;

    it('should complete full documentation generation workflow', async () => {
      // Mock successful documentation generation
      const mockDocumentation = {
        description: 'Customer analytics pipeline that processes transaction data',
        tableGrain: 'customer_id',
        dataSources: ['raw.customer_transactions'],
        databricksTables: ['analytics.customer_summary'],
        tableMetadata: [
          {
            tableName: 'analytics.customer_summary',
            columns: [
              { name: 'customer_id', type: 'string', description: 'Unique customer identifier' },
              { name: 'total_spend', type: 'decimal', description: 'Total customer spending' },
              { name: 'transaction_count', type: 'integer', description: 'Number of transactions' },
              { name: 'avg_transaction', type: 'decimal', description: 'Average transaction amount' }
            ]
          }
        ],
        integratedRules: ['Exclude customers with zero spend']
      };

      const mockReview = {
        overallScore: 8,
        needsImprovement: false,
        strengths: ['Clear column descriptions', 'Accurate data sources'],
        weaknesses: [],
        suggestions: [],
        specificIssues: {},
        priorityFixes: []
      };

      // Mock OpenAI responses
      const mockOpenAI = writer.openai;
      vi.mocked(mockOpenAI.chat.completions.create)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockDocumentation) } }]
        } as any)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockReview) } }]
        } as any);

      // Execute the workflow
      const result = await orchestrator.execute({
        pythonCode: samplePythonCode,
        filename: 'customer_analytics.py',
        excelContext: 'Customer data schema: customer_id, transaction_id, amount, date',
        userPreferences: { detailLevel: 'comprehensive' }
      });

      // Verify the result structure
      expect(result).toBeDefined();
      expect(result.overallScore).toBe(8);
      expect(result.needsImprovement).toBe(false);
    });

    it('should handle iterative improvement workflow', async () => {
      const initialDoc = {
        description: 'Basic customer processing',
        tableGrain: 'customer_id',
        dataSources: ['raw_data'],
        databricksTables: ['output'],
        tableMetadata: [],
        integratedRules: []
      };

      const criticalReview = {
        overallScore: 5,
        needsImprovement: true,
        strengths: ['Basic structure present'],
        weaknesses: ['Missing detailed descriptions', 'Incomplete metadata'],
        suggestions: ['Add column descriptions', 'Include business rules'],
        specificIssues: {
          tableMetadata: ['Missing column details'],
          description: ['Too generic']
        },
        priorityFixes: [
          {
            issue: 'Missing table metadata',
            priority: 'high' as const,
            suggestion: 'Add detailed column information'
          }
        ]
      };

      const improvedDoc = {
        ...initialDoc,
        description: 'Comprehensive customer analytics pipeline for business intelligence',
        tableMetadata: [
          {
            tableName: 'analytics.customer_summary',
            columns: [
              { name: 'customer_id', type: 'string', description: 'Unique customer identifier' }
            ]
          }
        ]
      };

      const finalReview = {
        overallScore: 8,
        needsImprovement: false,
        strengths: ['Comprehensive descriptions', 'Complete metadata'],
        weaknesses: [],
        suggestions: [],
        specificIssues: {},
        priorityFixes: []
      };

      // Mock the iteration sequence
      const mockOpenAI = writer.openai;
      vi.mocked(mockOpenAI.chat.completions.create)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(initialDoc) } }]
        } as any)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(criticalReview) } }]
        } as any)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(improvedDoc) } }]
        } as any)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(finalReview) } }]
        } as any);

      const result = await orchestrator.execute({
        pythonCode: samplePythonCode,
        filename: 'customer_analytics.py'
      });

      // Should go through improvement cycle
      expect(result.overallScore).toBe(8);
      expect(result.needsImprovement).toBe(false);
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(4);
    });
  });

  describe('Q&A Workflow', () => {
    it('should route questions to answer agent', async () => {
      const query = 'What does the process_customer_data function do?';

      // Mock router classification
      const classification = {
        intent: 'ask-doc' as const,
        confidence: 0.9,
        reasoning: 'User is asking about a specific function',
        extractedEntities: {
          filename: 'customer_analytics.py',
          topic: 'function explanation',
          action: 'explain'
        },
        suggestedAgent: 'answer',
        requiredParameters: ['question']
      };

      // Mock answer response
      const answerResponse = {
        answer: 'The process_customer_data function processes customer transaction data to calculate metrics including total spend, transaction count, and average transaction amount.',
        confidence: 0.9,
        sources: [
          {
            type: 'code' as const,
            content: 'def process_customer_data(df): ...',
            source: 'customer_analytics.py',
            score: 0.95
          }
        ],
        suggestedFollowUp: ['How is the data filtered?', 'What metrics are calculated?'],
        needsMoreInfo: false,
        clarifyingQuestions: []
      };

      // Mock OpenAI responses
      const mockOpenAI = router.openai;
      vi.mocked(mockOpenAI.chat.completions.create)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(classification) } }]
        } as any)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(answerResponse) } }]
        } as any);

      // Execute the Q&A workflow
      const result = await router.execute({
        query,
        context: {
          sessionId: 'test-session',
          userId: 'test-user'
        }
      });

      expect(result.answer).toContain('process_customer_data function');
      expect(result.confidence).toBe(0.9);
      expect(result.sources).toHaveLength(1);
    });

    it('should handle ambiguous queries with clarification', async () => {
      const ambiguousQuery = 'How does it work?';

      const classification = {
        intent: 'unknown' as const,
        confidence: 0.3,
        reasoning: 'Query is too vague and lacks context',
        extractedEntities: {},
        suggestedAgent: 'answer',
        requiredParameters: ['question']
      };

      const mockOpenAI = router.openai;
      vi.mocked(mockOpenAI.chat.completions.create)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(classification) } }]
        } as any);

      const result = await router.execute({
        query: ambiguousQuery,
        context: { sessionId: 'test-session' }
      });

      expect(result.classification.confidence).toBeLessThan(0.5);
      expect(result.classification.intent).toBe('unknown');
    });
  });

  describe('RAG Integration', () => {
    it('should retrieve and use relevant context in documentation generation', async () => {
      const { getRelevantContext } = await import('@/lib/embeddings');
      
      await writer.execute({
        pythonCode: samplePythonCode,
        filename: 'test.py'
      });

      // Verify RAG context was retrieved
      expect(getRelevantContext).toHaveBeenCalledWith(
        expect.stringContaining('test.py')
      );
    });

    it('should use context in answer generation', async () => {
      const { hybridSearch } = await import('@/lib/embeddings');

      await answer.execute({
        question: 'How do I process customer data?',
        context: { sessionId: 'test' }
      });

      // Verify search was performed
      expect(hybridSearch).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle OpenAI API failures gracefully', async () => {
      const mockOpenAI = writer.openai;
      vi.mocked(mockOpenAI.chat.completions.create)
        .mockRejectedValueOnce(new Error('OpenAI API Error'));

      await expect(writer.execute({
        pythonCode: 'def test(): pass',
        filename: 'test.py'
      })).rejects.toThrow('OpenAI API Error');
    });

    it('should handle vector database failures', async () => {
      const { searchVectors } = await import('@/lib/pinecone');
      vi.mocked(searchVectors).mockRejectedValueOnce(new Error('Pinecone Error'));

      await expect(answer.execute({
        question: 'Test question',
        context: { sessionId: 'test' }
      })).rejects.toThrow();
    });

    it('should handle workflow step failures in orchestrator', async () => {
      // Mock writer to fail
      const mockOpenAI = writer.openai;
      vi.mocked(mockOpenAI.chat.completions.create)
        .mockRejectedValueOnce(new Error('Writer failed'));

      await expect(orchestrator.execute({
        pythonCode: 'def test(): pass',
        filename: 'test.py'
      })).rejects.toThrow();
    });
  });

  describe('Agent Communication', () => {
    it('should properly route messages between agents', async () => {
      const message = {
        id: 'test-msg',
        from: 'orchestrator',
        to: 'writer',
        type: 'request' as const,
        content: {
          action: 'generate_documentation',
          input: {
            pythonCode: 'def test(): pass',
            filename: 'test.py'
          }
        },
        timestamp: Date.now()
      };

      // Spy on message handling
      const receiveSpy = vi.spyOn(writer, 'receiveMessage');
      
      await agentRegistry.routeMessage(message);
      
      expect(receiveSpy).toHaveBeenCalledWith(message);
    });

    it('should handle message routing errors', async () => {
      const message = {
        id: 'test-msg',
        from: 'orchestrator',
        to: 'non-existent-agent',
        type: 'request' as const,
        content: {},
        timestamp: Date.now()
      };

      await expect(agentRegistry.routeMessage(message)).rejects.toThrow(
        'Agent non-existent-agent not found'
      );
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large python files efficiently', async () => {
      const largePythonCode = `
# Large Python file with multiple functions and classes
${Array(100).fill(0).map((_, i) => `
def function_${i}():
    """Function ${i} documentation."""
    return ${i}

class Class${i}:
    def __init__(self):
        self.value = ${i}
    
    def method_${i}(self):
        return self.value * 2
`).join('\n')}
      `;

      const mockDoc = {
        description: 'Large multi-function module',
        tableGrain: 'record_id',
        dataSources: ['input_data'],
        databricksTables: ['output_data'],
        tableMetadata: [],
        integratedRules: []
      };

      const mockOpenAI = writer.openai;
      vi.mocked(mockOpenAI.chat.completions.create)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockDoc) } }]
        } as any);

      const startTime = Date.now();
      const result = await writer.execute({
        pythonCode: largePythonCode,
        filename: 'large_module.py'
      });
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(30000); // Should complete within 30 seconds
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(5).fill(0).map((_, i) => ({
        pythonCode: `def function_${i}(): return ${i}`,
        filename: `test_${i}.py`
      }));

      const mockDoc = {
        description: 'Test function',
        tableGrain: 'id',
        dataSources: ['test'],
        databricksTables: ['output'],
        tableMetadata: [],
        integratedRules: []
      };

      const mockOpenAI = writer.openai;
      vi.mocked(mockOpenAI.chat.completions.create)
        .mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(mockDoc) } }]
        } as any);

      const promises = requests.map(req => writer.execute(req));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.description).toBe('Test function');
      });
    });
  });
});