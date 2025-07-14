import OpenAI from 'openai';
import { getRelevantContext } from '../embeddings';

// Agent communication message types
export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response' | 'feedback' | 'status';
  content: unknown;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// Agent execution context
export interface AgentContext {
  sessionId: string;
  userId?: string;
  taskId: string;
  messages: AgentMessage[];
  sharedState: Record<string, unknown>;
  retrievalContext?: string;
}

// Agent configuration
export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enableRAG: boolean;
  ragOptions?: {
    includeDocuments?: boolean;
    includeCode?: boolean;
    includeQA?: boolean;
    includeKPIs?: boolean;
    maxTokens?: number;
    minScore?: number;
  };
}

// Base Agent class
export abstract class BaseAgent {
  protected openai: OpenAI;
  protected config: AgentConfig;
  protected context: AgentContext;

  constructor(config: AgentConfig) {
    this.config = config;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
    this.context = {
      sessionId: '',
      taskId: '',
      messages: [],
      sharedState: {}
    };
  }

  // Initialize agent with context
  async initialize(context: AgentContext): Promise<void> {
    this.context = { ...context };
    await this.onInitialize();
  }

  // Abstract method for agent-specific initialization
  protected async onInitialize(): Promise<void> {
    // Override in subclasses
  }

  // Send message to another agent
  async sendMessage(
    to: string,
    type: AgentMessage['type'],
    content: unknown,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const message: AgentMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from: this.config.name,
      to,
      type,
      content,
      timestamp: Date.now(),
      metadata
    };

    this.context.messages.push(message);
    await this.onMessageSent(message);
  }

  // Handle received message
  async receiveMessage(message: AgentMessage): Promise<void> {
    this.context.messages.push(message);
    await this.onMessageReceived(message);
  }

  // Abstract method for handling received messages
  protected abstract onMessageReceived(message: AgentMessage): Promise<void>;

  // Hook for when message is sent
  protected async onMessageSent(message: AgentMessage): Promise<void> {
    // Override in subclasses if needed
  }

  // Get RAG context for a query
  protected async getRAGContext(query: string): Promise<string> {
    if (!this.config.enableRAG) {
      return '';
    }

    const options = this.config.ragOptions || {};
    
    return await getRelevantContext(query, options.maxTokens || 4000, {
      includeDocuments: options.includeDocuments ?? true,
      includeCode: options.includeCode ?? true,
      includeQA: options.includeQA ?? true,
      minScore: options.minScore ?? 0.7
    });
  }

  // Generate OpenAI chat completion
  protected async generateCompletion(
    messages: Array<{ role: string; content: string }>,
    options: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    } = {}
  ): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: this.config.model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: options.temperature ?? this.config.temperature,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      stream: options.stream ?? false,
    });

    if (options.stream) {
      throw new Error('Streaming not supported in this method');
    }

    return (response as OpenAI.Chat.Completions.ChatCompletion).choices[0]?.message?.content || '';
  }

  // Generate streaming completion
  protected async generateStreamingCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken?: (token: string) => void,
    options: {
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<string> {
    const stream = await this.openai.chat.completions.create({
      model: this.config.model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: options.temperature ?? this.config.temperature,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      stream: true,
    });

    let fullResponse = '';
    
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        fullResponse += token;
        if (onToken) {
          onToken(token);
        }
      }
    }

    return fullResponse;
  }

  // Update shared state
  protected updateSharedState(key: string, value: unknown): void {
    this.context.sharedState[key] = value;
  }

  // Get shared state
  protected getSharedState(key: string): unknown {
    return this.context.sharedState[key];
  }

  // Abstract method for main agent execution
  abstract execute(input: unknown): Promise<unknown>;

  // Get agent config
  getConfig(): AgentConfig {
    return this.config;
  }

  // Get agent status
  getStatus(): {
    name: string;
    active: boolean;
    lastActivity: number;
    messageCount: number;
  } {
    return {
      name: this.config.name,
      active: true,
      lastActivity: Date.now(),
      messageCount: this.context.messages.length
    };
  }
}

// Agent registry for managing multiple agents
export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private messageQueue: AgentMessage[] = [];
  private processing = false;

  // Register an agent
  register(agent: BaseAgent): void {
    this.agents.set(agent.getConfig().name, agent);
  }

  // Get agent by name
  get(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }

  // Route message between agents
  async routeMessage(message: AgentMessage): Promise<void> {
    const targetAgent = this.agents.get(message.to);
    if (targetAgent) {
      await targetAgent.receiveMessage(message);
    } else {
      throw new Error(`Agent ${message.to} not found`);
    }
  }

  // Process message queue
  async processMessages(): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      await this.routeMessage(message);
    }
    
    this.processing = false;
  }

  // Queue message for processing
  queueMessage(message: AgentMessage): void {
    this.messageQueue.push(message);
  }

  // Get all registered agents
  getAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  // Get agent statuses
  getStatuses(): Array<{ name: string; active: boolean; lastActivity: number; messageCount: number }> {
    return this.getAgents().map(agent => agent.getStatus());
  }
}

// Global agent registry instance
export const agentRegistry = new AgentRegistry();