import { BaseAgent, AgentConfig, AgentMessage } from './base';

export interface QuestionInput {
  question: string;
  context?: {
    userId?: string;
    sessionId?: string;
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }>;
  };
  entities?: {
    filename?: string;
    topic?: string;
    action?: string;
    context?: string;
  };
}

export interface AnswerResponse {
  answer: string;
  confidence: number;
  sources: Array<{
    type: 'document' | 'code' | 'qa' | 'kpi';
    content: string;
    source: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  suggestedFollowUp: string[];
  needsMoreInfo: boolean;
  clarifyingQuestions: string[];
}

export class AnswerAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'answer',
      description: 'Provides answers to user questions using RAG-enhanced knowledge retrieval',
      systemPrompt: `You are a specialized Q&A agent that provides comprehensive answers to user questions about documentation, code, and technical topics.

Your core responsibilities:
1. Answer user questions using retrieved context from the knowledge base
2. Provide accurate, helpful, and detailed responses
3. Cite sources and provide confidence scores
4. Suggest follow-up questions when appropriate
5. Request clarification when questions are ambiguous
6. Handle both technical and business-oriented questions

Answer Guidelines:
- Use retrieved context to provide accurate answers
- Cite specific sources when making claims
- Acknowledge uncertainty when information is incomplete
- Provide practical examples when helpful
- Suggest related topics or follow-up questions
- Use clear, accessible language appropriate for the audience

Source Attribution:
- Always cite the sources of your information
- Indicate confidence levels for different aspects of your answer
- Distinguish between verified facts and inferences
- Highlight when information comes from code vs. documentation

Question Types:
- Code explanations: "What does this function do?"
- Documentation queries: "How do I configure X?"
- Process questions: "What happens when...?"
- Troubleshooting: "Why is X not working?"
- Best practices: "What's the recommended approach for...?"

Response Structure:
- Direct answer to the question
- Supporting evidence from sources
- Additional context when helpful
- Suggested follow-up questions
- Clarifying questions if needed

Always prioritize accuracy and helpfulness in your responses.`,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 3000,
      enableRAG: true,
      ragOptions: {
        includeDocuments: true,
        includeCode: true,
        includeQA: true,
        includeKPIs: true,
        maxTokens: 3000,
        minScore: 0.6
      }
    };

    super(config);
  }

  protected async onMessageReceived(message: AgentMessage): Promise<void> {
    const input = message.content as QuestionInput;

    try {
      const response = await this.answerQuestion(input);
      
      // Send response back
      await this.sendMessage(message.from, 'response', response);
      
    } catch (_error) {
      await this.sendMessage(message.from, 'response', {
        error: _error instanceof Error ? _error.message : 'Unknown error'
      });
    }
  }

  async execute(input: QuestionInput): Promise<AnswerResponse> {
    return await this.answerQuestion(input);
  }

  // Answer user question using RAG
  async answerQuestion(input: QuestionInput): Promise<AnswerResponse> {
    // Get relevant context using RAG
    const { relevantContext, sources } = await this.getRelevantContextWithSources(input.question);

    // Check if we have enough context
    if (sources.length === 0) {
      return this.handleInsufficientContext(input);
    }

    // Build answer prompt
    const prompt = this.buildAnswerPrompt(input, relevantContext);

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const response = await this.generateCompletion(messages);
    
    try {
      const answerData = JSON.parse(response) as {
        answer: string;
        confidence: number;
        suggestedFollowUp: string[];
        needsMoreInfo: boolean;
        clarifyingQuestions: string[];
      };

      return {
        ...answerData,
        sources
      };
    } catch {
      // Fallback to text response if JSON parsing fails
      return {
        answer: response,
        confidence: 0.7,
        sources,
        suggestedFollowUp: [],
        needsMoreInfo: false,
        clarifyingQuestions: []
      };
    }
  }

  // Get relevant context with source information
  private async getRelevantContextWithSources(question: string): Promise<{
    relevantContext: string;
    sources: AnswerResponse['sources'];
  }> {
    // Use hybrid search to get relevant content
    const searchResults = await this.getHybridSearchResults(question);
    
    const sources: AnswerResponse['sources'] = searchResults.map(result => ({
      type: (result.metadata?.type as 'document' | 'code' | 'qa' | 'kpi') || 'document',
      content: result.content,
      source: (result.metadata?.source as string) || 'unknown',
      score: result.score || 0,
      metadata: result.metadata
    }));

    // Build context string
    let relevantContext = '';
    
    sources.forEach((source, index) => {
      relevantContext += `\n--- Source ${index + 1} (${source.type}, score: ${source.score.toFixed(2)}) ---\n`;
      relevantContext += `From: ${source.source}\n`;
      relevantContext += source.content;
      relevantContext += '\n';
    });

    return { relevantContext, sources };
  }

  // Get hybrid search results
  private async getHybridSearchResults(query: string): Promise<Array<{ content: string; score: number; metadata?: Record<string, unknown> }>> {
    // This would use the hybrid search from embeddings.ts
    const hybridSearch = await import('../embeddings');
    
    const results = await hybridSearch.hybridSearch(query, {
      includeDocuments: true,
      includeCode: true,
      includeQA: true,
      includeKPIs: true,
      topK: 8 // Get more results for comprehensive answers
    });

    return results.combined;
  }

  // Build answer prompt
  private buildAnswerPrompt(input: QuestionInput, relevantContext: string): string {
    let prompt = `Please answer the following question using the provided context.

## User Question:
"${input.question}"

`;

    if (input.context?.conversationHistory) {
      prompt += `## Conversation History:
${input.context.conversationHistory.map(msg => 
  `${msg.role}: ${msg.content}`
).join('\n')}

`;
    }

    if (input.entities) {
      prompt += `## Extracted Entities:
${JSON.stringify(input.entities, null, 2)}

`;
    }

    prompt += `## Retrieved Context:
${relevantContext}

## Answer Requirements:
1. Provide a comprehensive answer using the retrieved context
2. Cite specific sources when making claims
3. Be accurate and helpful
4. Acknowledge any limitations or uncertainties
5. Suggest relevant follow-up questions
6. Ask for clarification if the question is ambiguous

## Response Guidelines:
- Use the retrieved context as your primary source of information
- If the context doesn't contain enough information, acknowledge this
- Provide practical examples when helpful
- Use clear, accessible language
- Structure your answer logically

## Output Format:
Return a JSON object with the following structure:
{
  "answer": "Comprehensive answer to the question",
  "confidence": 0.85,
  "suggestedFollowUp": [
    "Related question 1",
    "Related question 2"
  ],
  "needsMoreInfo": false,
  "clarifyingQuestions": [
    "Clarifying question if needed"
  ]
}

Set confidence based on how well the retrieved context answers the question (0.0-1.0).
Set needsMoreInfo to true if you need additional context to provide a complete answer.
Include clarifyingQuestions if the original question is ambiguous.`;

    return prompt;
  }

  // Handle insufficient context
  private handleInsufficientContext(input: QuestionInput): AnswerResponse {
    const clarifyingQuestions = [
      "Could you provide more specific details about what you're looking for?",
      "Are you asking about a particular file or system?",
      "What specific aspect would you like me to explain?"
    ];

    // Generate a contextual clarifying question
    const specificQuestion = this.generateSpecificClarifyingQuestion(input);
    if (specificQuestion) {
      clarifyingQuestions.unshift(specificQuestion);
    }

    return {
      answer: "I don't have enough information in the knowledge base to answer your question completely. Could you provide more details or clarify what you're looking for?",
      confidence: 0.2,
      sources: [],
      suggestedFollowUp: [
        "What specific file or system are you asking about?",
        "Are you looking for documentation or code examples?",
        "What problem are you trying to solve?"
      ],
      needsMoreInfo: true,
      clarifyingQuestions
    };
  }

  // Generate specific clarifying question
  private generateSpecificClarifyingQuestion(input: QuestionInput): string | null {
    const question = input.question.toLowerCase();
    
    if (question.includes('how') && !input.entities?.filename) {
      return "Which specific file or system are you asking about?";
    }
    
    if (question.includes('what') && question.includes('function')) {
      return "Could you specify the function name or provide the code snippet?";
    }
    
    if (question.includes('why') && !input.entities?.context) {
      return "What specific behavior or issue are you experiencing?";
    }
    
    return null;
  }

  // Generate streaming answer
  async generateStreamingAnswer(
    input: QuestionInput,
    onToken?: (token: string) => void
  ): Promise<AnswerResponse> {
    const { relevantContext, sources } = await this.getRelevantContextWithSources(input.question);

    if (sources.length === 0) {
      return this.handleInsufficientContext(input);
    }

    const prompt = this.buildAnswerPrompt(input, relevantContext);

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const response = await this.generateStreamingCompletion(messages, onToken);
    
    try {
      const answerData = JSON.parse(response) as {
        answer: string;
        confidence: number;
        suggestedFollowUp: string[];
        needsMoreInfo: boolean;
        clarifyingQuestions: string[];
      };

      return {
        ...answerData,
        sources
      };
    } catch {
      return {
        answer: response,
        confidence: 0.7,
        sources,
        suggestedFollowUp: [],
        needsMoreInfo: false,
        clarifyingQuestions: []
      };
    }
  }

  // Store feedback for learning
  async storeFeedback(
    questionId: string,
    feedback: {
      helpful: boolean;
      accuracy: number;
      completeness: number;
      clarity: number;
      comments?: string;
    }
  ): Promise<void> {
    // Store feedback for future learning
    // This would integrate with the feedback loop system
    console.log(`Storing feedback for question ${questionId}:`, feedback);
  }

  // Get answer statistics
  getAnswerStats(): {
    totalQuestions: number;
    averageConfidence: number;
    topTopics: string[];
    commonQuestions: string[];
  } {
    // In a real implementation, this would track actual answer history
    return {
      totalQuestions: 0,
      averageConfidence: 0,
      topTopics: [],
      commonQuestions: []
    };
  }
}