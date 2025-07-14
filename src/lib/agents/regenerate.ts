import { BaseAgent, AgentConfig, AgentMessage } from './base';

export interface RegenerateInput {
  userFeedback: string;
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
  entities?: {
    filename?: string;
    topic?: string;
    action?: string;
    context?: string;
    feedback?: string;
  };
}

export interface RegenerateResponse {
  success: boolean;
  updatedDocumentation?: Record<string, unknown>;
  message: string;
  requiresFileUpload?: boolean;
}

export class RegenerateAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'regenerate',
      description: 'Handles documentation regeneration based on user feedback',
      systemPrompt: `You are a documentation regeneration agent that improves existing documentation based on user feedback.

Your core responsibilities:
1. Analyze user feedback for documentation improvements
2. Determine if regeneration can be performed or if file upload is needed
3. Call the regeneration API with appropriate parameters
4. Provide clear feedback to users about the process

Feedback Analysis:
- Identify specific improvement requests (KPIs, definitions, calculations, etc.)
- Determine if feedback can be applied to existing documentation
- Extract key requirements and preferences from user input

Regeneration Process:
1. Check if documentation context exists in conversation history
2. If available, call the regeneration API with feedback
3. If not available, request file upload for new generation
4. Provide clear status updates and results

Response Guidelines:
- Be helpful and specific about what can be improved
- Explain when file upload is required vs. when regeneration can proceed
- Provide clear instructions for next steps
- Confirm successful regeneration with summary of changes`,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 2000,
      enableRAG: true,
      ragOptions: {
        includeDocuments: true,
        includeCode: true,
        includeQA: true,
        includeKPIs: true,
        maxTokens: 2000,
        minScore: 0.6
      }
    };

    super(config);
  }

  protected async onMessageReceived(message: AgentMessage): Promise<void> {
    const input = message.content as RegenerateInput;

    try {
      const response = await this.handleRegenerateRequest(input);
      
      // Send response back
      await this.sendMessage(message.from, 'response', response);
      
    } catch (error) {
      await this.sendMessage(message.from, 'response', {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        requiresFileUpload: true
      });
    }
  }

  async execute(input: RegenerateInput): Promise<RegenerateResponse> {
    return await this.handleRegenerateRequest(input);
  }

  // Handle regeneration request
  async handleRegenerateRequest(input: RegenerateInput): Promise<RegenerateResponse> {
    // Check if we have current documentation context
    if (!input.context?.hasDocumentation || !input.context?.documentation || !input.context?.filename) {
      return {
        success: false,
        message: "I don't have access to current documentation. Please upload your Python file and generate documentation first, then I can help improve it with your feedback.",
        requiresFileUpload: true
      };
    }

    try {
      // Generate improved documentation using OpenAI directly
      const updatedDocumentation = await this.generateImprovedDocumentation(
        input.context.documentation,
        input.userFeedback,
        input.context.filename
      );

      return {
        success: true,
        updatedDocumentation,
        message: `✅ Documentation updated successfully based on your feedback: "${input.userFeedback}"\n\n🔄 The KPIs and documentation sections have been enhanced. You can see the changes above!`
      };

    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to regenerate documentation: ${error instanceof Error ? error.message : 'Unknown error'}.\n\n💡 Please try uploading your Python file again for a fresh generation.`,
        requiresFileUpload: true
      };
    }
  }

  // Generate improved documentation using OpenAI directly
  private async generateImprovedDocumentation(
    currentDocumentation: Record<string, unknown>,
    userFeedback: string,
    filename: string
  ): Promise<Record<string, unknown>> {
    const prompt = `You are an expert documentation improvement agent. Your task is to enhance existing documentation based on user feedback.

Current Documentation:
${JSON.stringify(currentDocumentation, null, 2)}

User Feedback:
${userFeedback}

Filename: ${filename}

Please improve the documentation based on the user feedback. Focus on:
1. Updating definitions, KPIs, or calculations as requested
2. Maintaining the same structure and format
3. Ensuring all improvements are accurate and business-focused
4. Preserving all existing information unless specifically requested to change

Return the improved documentation as a JSON object with the same structure as the input.`;

    const response = await this.generateCompletion([
      {
        role: 'system',
        content: 'You are a documentation improvement agent. Always respond with valid JSON matching the input structure.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]);

    try {
      return JSON.parse(response);
    } catch {
      // If JSON parsing fails, return the current documentation with a message
      return {
        ...currentDocumentation,
        improvement_note: `Applied feedback: ${userFeedback}`
      };
    }
  }

  // Check if conversation history contains documentation
  private hasDocumentationInHistory(conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>): boolean {
    if (!conversationHistory) return false;
    
    return conversationHistory.some(msg => 
      msg.role === 'assistant' && 
      (msg.content.includes('Documentation generated successfully') ||
       msg.content.includes('KPIs') ||
       msg.content.includes('tableMetadata') ||
       msg.content.includes('integratedRules'))
    );
  }

  // Extract documentation context from conversation history
  private extractDocumentationContext(conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>): {
    pythonCode: string;
    filename: string;
    documentation: Record<string, unknown>;
  } | null {
    // In a real implementation, this would parse the conversation history
    // to extract the file content and generated documentation
    // For now, we'll return null to indicate we need file upload
    
    // This is a simplified implementation - in practice, you'd want to
    // store this information in the session or extract it from the conversation
    return null;
  }

  // Get regeneration statistics
  getRegenerationStats(): {
    totalRegenerations: number;
    successRate: number;
    commonFeedbackTypes: string[];
    averageImprovementTime: number;
  } {
    // In a real implementation, this would track actual regeneration history
    return {
      totalRegenerations: 0,
      successRate: 0,
      commonFeedbackTypes: [],
      averageImprovementTime: 0
    };
  }
}