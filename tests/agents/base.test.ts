import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseAgent, AgentConfig, AgentMessage, AgentContext, agentRegistry } from '@/lib/agents/base';

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test response' } }]
        })
      }
    }
  }))
}));

// Mock embeddings
vi.mock('@/lib/embeddings', () => ({
  getRelevantContext: vi.fn().mockResolvedValue('Mock context')
}));

// Test implementation of BaseAgent
class TestAgent extends BaseAgent {
  protected async onMessageReceived(message: AgentMessage): Promise<void> {
    // Store received message for testing
    const existing = this.getSharedState('receivedMessages') || [];
    existing.push(message);
    this.updateSharedState('receivedMessages', existing);
  }

  async execute(input: any): Promise<any> {
    return { result: `Processed: ${input}` };
  }
}

describe('BaseAgent', () => {
  let testAgent: TestAgent;
  let agentConfig: AgentConfig;
  let agentContext: AgentContext;

  beforeEach(() => {
    agentConfig = {
      name: 'test-agent',
      description: 'Test agent for unit testing',
      systemPrompt: 'You are a test agent',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 1000,
      enableRAG: false
    };

    agentContext = {
      sessionId: 'test-session',
      taskId: 'test-task',
      messages: [],
      sharedState: {}
    };

    testAgent = new TestAgent(agentConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with correct config', () => {
      expect(testAgent.config.name).toBe('test-agent');
      expect(testAgent.config.model).toBe('gpt-4o-mini');
      expect(testAgent.config.enableRAG).toBe(false);
    });

    it('should initialize context correctly', async () => {
      await testAgent.initialize(agentContext);
      expect(testAgent.context.sessionId).toBe('test-session');
      expect(testAgent.context.taskId).toBe('test-task');
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      await testAgent.initialize(agentContext);
    });

    it('should send messages correctly', async () => {
      await testAgent.sendMessage('target-agent', 'request', { data: 'test' });
      
      expect(testAgent.context.messages).toHaveLength(1);
      expect(testAgent.context.messages[0].from).toBe('test-agent');
      expect(testAgent.context.messages[0].to).toBe('target-agent');
      expect(testAgent.context.messages[0].type).toBe('request');
      expect(testAgent.context.messages[0].content).toEqual({ data: 'test' });
    });

    it('should receive messages correctly', async () => {
      const message: AgentMessage = {
        id: 'test-msg',
        from: 'other-agent',
        to: 'test-agent',
        type: 'request',
        content: { action: 'test' },
        timestamp: Date.now()
      };

      await testAgent.receiveMessage(message);
      
      expect(testAgent.context.messages).toHaveLength(1);
      expect(testAgent.context.messages[0]).toEqual(message);
      
      const receivedMessages = testAgent.getSharedState('receivedMessages');
      expect(receivedMessages).toContain(message);
    });
  });

  describe('shared state management', () => {
    beforeEach(async () => {
      await testAgent.initialize(agentContext);
    });

    it('should update and retrieve shared state', () => {
      testAgent.updateSharedState('testKey', 'testValue');
      expect(testAgent.getSharedState('testKey')).toBe('testValue');
    });

    it('should handle complex shared state objects', () => {
      const complexObject = { nested: { data: [1, 2, 3] } };
      testAgent.updateSharedState('complexKey', complexObject);
      expect(testAgent.getSharedState('complexKey')).toEqual(complexObject);
    });
  });

  describe('OpenAI integration', () => {
    beforeEach(async () => {
      await testAgent.initialize(agentContext);
    });

    it('should generate completions', async () => {
      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Test message' }
      ];

      const response = await testAgent.generateCompletion(messages);
      expect(response).toBe('Test response');
    });

    it('should use correct model and parameters', async () => {
      const messages = [{ role: 'user', content: 'Test' }];
      
      await testAgent.generateCompletion(messages, {
        temperature: 0.5,
        maxTokens: 500
      });

      // Verify the OpenAI mock was called
      expect(testAgent.openai.chat.completions.create).toHaveBeenCalled();
    });
  });

  describe('RAG integration', () => {
    beforeEach(async () => {
      // Enable RAG for this test
      agentConfig.enableRAG = true;
      agentConfig.ragOptions = {
        includeDocuments: true,
        includeCode: true,
        maxTokens: 2000
      };
      testAgent = new TestAgent(agentConfig);
      await testAgent.initialize(agentContext);
    });

    it('should retrieve RAG context when enabled', async () => {
      const context = await testAgent.getRAGContext('test query');
      expect(context).toBe('Mock context');
    });

    it('should return empty context when RAG disabled', async () => {
      testAgent.config.enableRAG = false;
      const context = await testAgent.getRAGContext('test query');
      expect(context).toBe('');
    });
  });

  describe('execution', () => {
    beforeEach(async () => {
      await testAgent.initialize(agentContext);
    });

    it('should execute with input and return result', async () => {
      const result = await testAgent.execute('test input');
      expect(result).toEqual({ result: 'Processed: test input' });
    });
  });

  describe('status reporting', () => {
    beforeEach(async () => {
      await testAgent.initialize(agentContext);
    });

    it('should return correct status', () => {
      const status = testAgent.getStatus();
      expect(status.name).toBe('test-agent');
      expect(status.active).toBe(true);
      expect(status.messageCount).toBe(0);
      expect(typeof status.lastActivity).toBe('number');
    });

    it('should update message count after receiving messages', async () => {
      const message: AgentMessage = {
        id: 'test',
        from: 'sender',
        to: 'test-agent',
        type: 'request',
        content: {},
        timestamp: Date.now()
      };

      await testAgent.receiveMessage(message);
      const status = testAgent.getStatus();
      expect(status.messageCount).toBe(1);
    });
  });
});

describe('AgentRegistry', () => {
  let agent1: TestAgent;
  let agent2: TestAgent;

  beforeEach(() => {
    // Clear registry
    agentRegistry.getAgents().forEach(agent => {
      // Remove all agents (this is a simplification for testing)
    });

    agent1 = new TestAgent({
      name: 'agent-1',
      description: 'Test agent 1',
      systemPrompt: 'Test',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 1000,
      enableRAG: false
    });

    agent2 = new TestAgent({
      name: 'agent-2',
      description: 'Test agent 2',
      systemPrompt: 'Test',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 1000,
      enableRAG: false
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('agent registration', () => {
    it('should register agents', () => {
      agentRegistry.register(agent1);
      agentRegistry.register(agent2);

      expect(agentRegistry.get('agent-1')).toBe(agent1);
      expect(agentRegistry.get('agent-2')).toBe(agent2);
    });

    it('should return undefined for non-existent agents', () => {
      expect(agentRegistry.get('non-existent')).toBeUndefined();
    });
  });

  describe('message routing', () => {
    beforeEach(() => {
      agentRegistry.register(agent1);
      agentRegistry.register(agent2);
    });

    it('should route messages between agents', async () => {
      const message: AgentMessage = {
        id: 'test-route',
        from: 'agent-1',
        to: 'agent-2',
        type: 'request',
        content: { action: 'test' },
        timestamp: Date.now()
      };

      await agentRegistry.routeMessage(message);
      
      // Check that agent2 received the message
      const receivedMessages = agent2.getSharedState('receivedMessages');
      expect(receivedMessages).toContain(message);
    });

    it('should throw error for non-existent target agent', async () => {
      const message: AgentMessage = {
        id: 'test-error',
        from: 'agent-1',
        to: 'non-existent',
        type: 'request',
        content: {},
        timestamp: Date.now()
      };

      await expect(agentRegistry.routeMessage(message)).rejects.toThrow(
        'Agent non-existent not found'
      );
    });
  });

  describe('agent management', () => {
    beforeEach(() => {
      agentRegistry.register(agent1);
      agentRegistry.register(agent2);
    });

    it('should return all registered agents', () => {
      const agents = agentRegistry.getAgents();
      expect(agents).toContain(agent1);
      expect(agents).toContain(agent2);
      expect(agents.length).toBeGreaterThanOrEqual(2);
    });

    it('should return agent statuses', () => {
      const statuses = agentRegistry.getStatuses();
      expect(statuses.length).toBeGreaterThanOrEqual(2);
      expect(statuses.some(s => s.name === 'agent-1')).toBe(true);
      expect(statuses.some(s => s.name === 'agent-2')).toBe(true);
    });
  });
});