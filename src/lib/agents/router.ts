import { BaseAgent, AgentConfig, AgentMessage, agentRegistry } from './base';

export interface QueryClassification {
  intent: 'ask-doc' | 'generate-doc' | 'improve-doc' | 'manage-kb' | 'unknown';
  confidence: number;
  reasoning: string;
  extractedEntities: {
    filename?: string;
    topic?: string;
    action?: string;
    context?: string;
    feedback?: string;
  };
  suggestedAgent: string;
  requiredParameters: string[];
}

export interface RouterInput {
  query: string;
  context?: {
    userId?: string;
    sessionId?: string;
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }>;
    hasDocumentation?: boolean;
    filename?: string;
    documentation?: Record<string, unknown>;
  };
}

export class RouterAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'router',
      description: 'Routes user queries to appropriate agents based on intent classification',
      systemPrompt: `You are a router agent that classifies user queries and routes them to the appropriate specialized agents.

Your core responsibilities:
1. Analyze user queries to determine intent
2. Extract relevant entities and context
3. Route to the appropriate agent
4. Provide confidence scores for classifications
5. Handle ambiguous queries with clarifying questions

Intent Classification:
- "ask-doc": Questions about existing documentation, code explanations, Q&A
- "generate-doc": Requests to create new documentation from code
- "improve-doc": Requests to improve, modify, or regenerate existing documentation with feedback
- "manage-kb": Knowledge base management operations
- "unknown": Unclear or out-of-scope queries

Available Agents:
- orchestrator: For complex documentation generation workflows
- answer: For Q&A and document queries
- writer: For direct documentation generation
- critic: For documentation review
- regenerate: For improving existing documentation with user feedback

Entity Extraction:
- filename: Specific file mentioned
- topic: Subject matter or domain
- action: What the user wants to do
- context: Additional context or constraints
- feedback: User feedback or improvement requests for existing documentation

Classification Criteria:
- Look for keywords: "generate", "create", "document", "explain", "what", "how", "why"
- Look for improvement keywords: "improve", "update", "fix", "change", "modify", "regenerate", "better"
- Consider file uploads or code mentions
- Analyze question vs. request patterns
- Consider conversation context and whether documentation already exists
- Detect feedback or improvement requests

Always provide reasoning for your classification decisions.`,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.1, // Low temperature for consistent classification
      maxTokens: 1000,
      enableRAG: false // Router doesn't need RAG context
    };

    super(config);
  }

  protected async onMessageReceived(message: AgentMessage): Promise<void> {
    const content = message.content as { query: string; context: unknown };
    const { query, context } = content;

    try {
      const classification = await this.classifyQuery({ 
        query, 
        context: context as { userId?: string; sessionId?: string; conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> }
      });
      
      // Route to appropriate agent
      const routedResponse = await this.routeToAgent(classification, { 
        query, 
        context: context as { userId?: string; sessionId?: string; conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> }
      });
      
      // Send response back
      await this.sendMessage(message.from, 'response', {
        classification,
        response: routedResponse
      });
      
    } catch (error) {
      await this.sendMessage(message.from, 'response', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async execute(input: RouterInput): Promise<unknown> {
    const classification = await this.classifyQuery(input);
    return await this.routeToAgent(classification, input);
  }

  // Classify user query
  async classifyQuery(input: RouterInput): Promise<QueryClassification> {
    const prompt = this.buildClassificationPrompt(input);

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const response = await this.generateCompletion(messages);
    
    try {
      const classification = JSON.parse(response) as QueryClassification;
      this.validateClassification(classification);
      return classification;
    } catch (error) {
      throw new Error(`Failed to parse query classification: ${error}`);
    }
  }

  // Route to appropriate agent
  async routeToAgent(classification: QueryClassification, input: RouterInput): Promise<unknown> {
    const targetAgent = agentRegistry.get(classification.suggestedAgent);
    
    if (!targetAgent) {
      throw new Error(`Target agent ${classification.suggestedAgent} not found`);
    }

    // Prepare input for target agent based on intent
    const agentInput = this.prepareAgentInput(classification, input);
    
    // Execute on target agent
    return await targetAgent.execute(agentInput);
  }

  // Build classification prompt
  private buildClassificationPrompt(input: RouterInput): string {
    let prompt = `Please classify the following user query and determine the appropriate routing.

## User Query:
"${input.query}"

`;

    if (input.context?.conversationHistory) {
      prompt += `## Conversation History:
${input.context.conversationHistory.map(msg => 
  `${msg.role}: ${msg.content}`
).join('\n')}

`;
    }

    if (input.context?.userId) {
      prompt += `## User ID: ${input.context.userId}
`;
    }

    prompt += `## Classification Task:
Analyze the query and provide a classification with the following considerations:

1. **Intent Analysis:**
   - "ask-doc": User is asking questions about existing documentation, code, or needs explanations
   - "generate-doc": User wants to create new documentation from code
   - "improve-doc": User wants to improve, modify, or regenerate existing documentation with feedback
   - "manage-kb": User wants to manage knowledge base (upload, delete, search)
   - "unknown": Query is unclear or out of scope

2. **Entity Extraction:**
   - Look for filenames, file types, or specific code references
   - Identify the topic or domain area
   - Determine the specific action requested
   - Extract any additional context or constraints

3. **Agent Routing:**
   - orchestrator: Complex documentation generation workflows
   - answer: Q&A, explanations, document queries
   - writer: Direct documentation generation requests
   - critic: Documentation review or quality assessment
   - regenerate: Documentation improvement with user feedback

4. **Confidence Assessment:**
   - High (0.8-1.0): Clear intent and entities
   - Medium (0.5-0.7): Somewhat clear but may need clarification
   - Low (0.0-0.4): Ambiguous or unclear

## Examples:
- "Generate documentation for my Python script" → generate-doc, orchestrator
- "What does this function do?" → ask-doc, answer
- "How do I upload documents?" → manage-kb, answer
- "Review this documentation" → ask-doc, critic
- "Improve the uptime percentage definition" → improve-doc, regenerate
- "Generate a new doc with better KPIs" → improve-doc, regenerate
- "Update the documentation to include more metrics" → improve-doc, regenerate

## Output Format:
Return ONLY a valid JSON object:
{
  "intent": "ask-doc",
  "confidence": 0.9,
  "reasoning": "User is asking a question about existing functionality",
  "extractedEntities": {
    "filename": "script.py",
    "topic": "python functions",
    "action": "explain",
    "context": "user needs understanding"
  },
  "suggestedAgent": "answer",
  "requiredParameters": ["query", "context"]
}`;

    return prompt;
  }

  // Prepare input for target agent
  private prepareAgentInput(classification: QueryClassification, input: RouterInput): unknown {
    switch (classification.intent) {
      case 'generate-doc':
        return {
          query: input.query,
          context: input.context,
          entities: classification.extractedEntities
        };
      
      case 'improve-doc':
        return {
          userFeedback: input.query,
          context: input.context,
          entities: classification.extractedEntities
        };
      
      case 'ask-doc':
        return {
          question: input.query,
          context: input.context,
          entities: classification.extractedEntities
        };
      
      case 'manage-kb':
        return {
          action: classification.extractedEntities.action || 'unknown',
          query: input.query,
          context: input.context
        };
      
      default:
        return {
          query: input.query,
          context: input.context,
          classification
        };
    }
  }

  // Validate classification structure
  private validateClassification(classification: QueryClassification): void {
    const requiredFields = [
      'intent',
      'confidence',
      'reasoning',
      'extractedEntities',
      'suggestedAgent',
      'requiredParameters'
    ];

    for (const field of requiredFields) {
      if (!(field in classification)) {
        throw new Error(`Missing required field in classification: ${field}`);
      }
    }

    // Validate intent values
    const validIntents = ['ask-doc', 'generate-doc', 'improve-doc', 'manage-kb', 'unknown'];
    if (!validIntents.includes(classification.intent)) {
      throw new Error(`Invalid intent: ${classification.intent}`);
    }

    // Validate confidence range
    if (classification.confidence < 0 || classification.confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }

    // Validate arrays
    if (!Array.isArray(classification.requiredParameters)) {
      throw new Error('Required parameters must be an array');
    }
  }

  // Handle ambiguous queries
  async handleAmbiguousQuery(input: RouterInput): Promise<string> {
    const prompt = `The user query is ambiguous. Generate a clarifying question to help understand their intent better.

User Query: "${input.query}"

Provide a helpful clarifying question that will help determine:
1. Whether they want to generate documentation or ask about existing content
2. What specific file or topic they're interested in
3. What type of help they need

Return only the clarifying question as a string.`;

    const messages = [
      { role: 'system', content: 'You help clarify ambiguous user queries with helpful questions.' },
      { role: 'user', content: prompt }
    ];

    return await this.generateCompletion(messages);
  }

  // Get routing statistics
  getRoutingStats(): {
    totalQueries: number;
    intentDistribution: Record<string, number>;
    agentDistribution: Record<string, number>;
    averageConfidence: number;
  } {
    // In a real implementation, this would track actual routing history
    return {
      totalQueries: 0,
      intentDistribution: {},
      agentDistribution: {},
      averageConfidence: 0
    };
  }

  // Suggest alternative routes
  async suggestAlternatives(classification: QueryClassification): Promise<string[]> {
    if (classification.confidence < 0.6) {
      const alternatives = [];
      
      // Suggest clarifying questions
      alternatives.push("Could you clarify what you'd like to do?");
      
      // Suggest common actions
      if (classification.intent === 'unknown') {
        alternatives.push("Are you looking to:");
        alternatives.push("- Generate documentation for a code file?");
        alternatives.push("- Ask questions about existing documentation?");
        alternatives.push("- Manage your knowledge base?");
      }
      
      return alternatives;
    }
    
    return [];
  }
}