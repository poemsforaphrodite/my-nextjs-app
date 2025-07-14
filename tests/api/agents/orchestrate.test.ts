import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the agents
vi.mock('@/lib/agents/orchestrator', () => ({
  OrchestratorAgent: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      id: 'workflow-123',
      status: 'completed',
      result: {
        description: 'Test documentation',
        tableGrain: 'customer_id',
        dataSources: ['test_data'],
        databricksTables: ['output_table'],
        tableMetadata: [],
        integratedRules: []
      }
    }),
    getWorkflowStatus: vi.fn(),
    cancelWorkflow: vi.fn(),
    initialize: vi.fn()
  }))
}));

vi.mock('@/lib/agents/writer', () => ({
  WriterAgent: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@/lib/agents/critic', () => ({
  CriticAgent: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@/lib/agents/base', () => ({
  agentRegistry: {
    register: vi.fn(),
    get: vi.fn(),
    getAgents: vi.fn().mockReturnValue([]),
    getStatuses: vi.fn().mockReturnValue([])
  }
}));

// Import the route handlers
import { POST, GET, DELETE } from '@/app/api/agents/orchestrate/route';

describe('/api/agents/orchestrate', () => {
  let mockRequest: NextRequest;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/agents/orchestrate', () => {
    const validRequestBody = {
      pythonCode: 'def test(): return "hello"',
      filename: 'test.py',
      excelContext: 'Optional excel context',
      existingDocs: 'Previous documentation',
      userPreferences: { style: 'detailed' }
    };

    beforeEach(() => {
      mockRequest = {
        json: vi.fn().mockResolvedValue(validRequestBody),
        headers: {
          get: vi.fn().mockReturnValue('application/json')
        }
      } as any;
    });

    it('should handle valid documentation generation request', async () => {
      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.result.description).toBe('Test documentation');
    });

    it('should validate required fields', async () => {
      const invalidBody = { filename: 'test.py' }; // Missing pythonCode
      (mockRequest.json as any).mockResolvedValueOnce(invalidBody);

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Python code and filename are required');
    });

    it('should handle streaming requests', async () => {
      const streamingRequest = {
        ...mockRequest,
        headers: {
          get: vi.fn().mockImplementation((header: string) => {
            if (header === 'accept') return 'text/event-stream';
            return 'application/json';
          })
        }
      } as any;

      const response = await POST(streamingRequest);

      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
    });

    it('should handle orchestrator execution errors', async () => {
      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      vi.mocked(mockOrchestrator.execute).mockRejectedValueOnce(new Error('Orchestration failed'));

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to orchestrate documentation generation');
    });

    it('should handle JSON parsing errors', async () => {
      (mockRequest.json as any).mockRejectedValueOnce(new Error('Invalid JSON'));

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to orchestrate documentation generation');
    });

    it('should pass all parameters to orchestrator', async () => {
      await POST(mockRequest);

      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      
      expect(mockOrchestrator.execute).toHaveBeenCalledWith({
        pythonCode: validRequestBody.pythonCode,
        filename: validRequestBody.filename,
        excelContext: validRequestBody.excelContext,
        existingDocs: validRequestBody.existingDocs,
        userPreferences: validRequestBody.userPreferences
      });
    });

    it('should handle optional parameters', async () => {
      const minimalBody = {
        pythonCode: 'def test(): pass',
        filename: 'minimal.py'
      };
      (mockRequest.json as any).mockResolvedValueOnce(minimalBody);

      const response = await POST(mockRequest);

      expect(response.status).toBe(200);
      
      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      
      expect(mockOrchestrator.execute).toHaveBeenCalledWith({
        pythonCode: minimalBody.pythonCode,
        filename: minimalBody.filename,
        excelContext: undefined,
        existingDocs: undefined,
        userPreferences: undefined
      });
    });
  });

  describe('GET /api/agents/orchestrate', () => {
    beforeEach(() => {
      mockRequest = {
        url: 'http://localhost:3000/api/agents/orchestrate?workflowId=test-workflow',
        headers: {
          get: vi.fn()
        }
      } as any;
    });

    it('should get workflow status', async () => {
      const mockStatus = {
        id: 'test-workflow',
        status: 'in_progress',
        currentStep: 2,
        steps: []
      };

      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      vi.mocked(mockOrchestrator.getWorkflowStatus).mockReturnValueOnce(mockStatus);

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockStatus);
    });

    it('should require workflowId parameter', async () => {
      const requestWithoutId = {
        url: 'http://localhost:3000/api/agents/orchestrate',
        headers: { get: vi.fn() }
      } as any;

      const response = await GET(requestWithoutId);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Workflow ID is required');
    });

    it('should handle non-existent workflow', async () => {
      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      vi.mocked(mockOrchestrator.getWorkflowStatus).mockReturnValueOnce(null);

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Workflow not found');
    });

    it('should handle errors getting workflow status', async () => {
      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      vi.mocked(mockOrchestrator.getWorkflowStatus).mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to get workflow status');
    });
  });

  describe('DELETE /api/agents/orchestrate', () => {
    beforeEach(() => {
      mockRequest = {
        url: 'http://localhost:3000/api/agents/orchestrate?workflowId=test-workflow',
        headers: {
          get: vi.fn()
        }
      } as any;
    });

    it('should cancel workflow', async () => {
      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      vi.mocked(mockOrchestrator.cancelWorkflow).mockResolvedValueOnce(undefined);

      const response = await DELETE(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Workflow cancelled');
      expect(mockOrchestrator.cancelWorkflow).toHaveBeenCalledWith('test-workflow');
    });

    it('should require workflowId parameter', async () => {
      const requestWithoutId = {
        url: 'http://localhost:3000/api/agents/orchestrate',
        headers: { get: vi.fn() }
      } as any;

      const response = await DELETE(requestWithoutId);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Workflow ID is required');
    });

    it('should handle cancellation errors', async () => {
      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      vi.mocked(mockOrchestrator.cancelWorkflow).mockRejectedValueOnce(new Error('Cancel failed'));

      const response = await DELETE(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to cancel workflow');
    });
  });

  describe('streaming functionality', () => {
    it('should properly initialize streaming response', async () => {
      const streamingRequest = {
        json: vi.fn().mockResolvedValue({
          pythonCode: 'def test(): pass',
          filename: 'test.py'
        }),
        headers: {
          get: vi.fn().mockImplementation((header: string) => {
            if (header === 'accept') return 'text/event-stream';
            return null;
          })
        }
      } as any;

      const response = await POST(streamingRequest);

      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('connection')).toBe('keep-alive');
    });

    it('should handle streaming errors gracefully', async () => {
      const streamingRequest = {
        json: vi.fn().mockResolvedValue({
          pythonCode: 'def test(): pass',
          filename: 'test.py'
        }),
        headers: {
          get: vi.fn().mockReturnValue('text/event-stream')
        }
      } as any;

      // Mock orchestrator to throw error
      const { OrchestratorAgent } = await import('@/lib/agents/orchestrator');
      const mockOrchestrator = new OrchestratorAgent();
      vi.mocked(mockOrchestrator.execute).mockRejectedValueOnce(new Error('Streaming error'));

      const response = await POST(streamingRequest);
      expect(response.headers.get('content-type')).toBe('text/event-stream');
    });
  });

  describe('agent registry integration', () => {
    it('should register all required agents', async () => {
      const { agentRegistry } = await import('@/lib/agents/base');
      
      // The route handler should register agents
      expect(agentRegistry.register).toHaveBeenCalledTimes(3); // orchestrator, writer, critic
    });

    it('should handle agent registration errors', async () => {
      const { agentRegistry } = await import('@/lib/agents/base');
      vi.mocked(agentRegistry.register).mockImplementationOnce(() => {
        throw new Error('Registration failed');
      });

      // Should still be able to handle requests despite registration issues
      const validRequest = {
        json: vi.fn().mockResolvedValue({
          pythonCode: 'def test(): pass',
          filename: 'test.py'
        }),
        headers: {
          get: vi.fn().mockReturnValue('application/json')
        }
      } as any;

      // Should not throw during import/initialization
      const response = await POST(validRequest);
      expect(response.status).toBe(200);
    });
  });
});