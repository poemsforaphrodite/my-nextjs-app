import { BaseAgent, AgentConfig, AgentMessage } from './base';
import { Documentation } from './writer';

export interface ReviewInput {
  documentation: Documentation;
  originalCode: string;
  filename: string;
  excelContext?: string;
  existingDocs?: string;
}

export interface ReviewFeedback {
  overallScore: number; // 1-10
  needsImprovement: boolean;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  specificIssues: {
    description?: string[];
    tableGrain?: string[];
    dataSources?: string[];
    databricksTables?: string[];
    tableMetadata?: string[];
    integratedRules?: string[];
    processFlow?: string[];
    kpis?: string[];
  };
  priorityFixes: Array<{
    issue: string;
    priority: 'high' | 'medium' | 'low';
    suggestion: string;
  }>;
}

export interface QualityMetrics {
  completeness: number;
  accuracy: number;
  clarity: number;
  businessValue: number;
  technicalDepth: number;
  consistency: number;
}

export class CriticAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'critic',
      description: 'Reviews and provides feedback on generated documentation for quality improvement',
      systemPrompt: `You are a specialized documentation critic that evaluates the quality of business documentation for Python data pipeline code.

Your core responsibilities:
1. Review generated documentation for completeness, accuracy, and clarity
2. Identify gaps between the original code and documentation
3. Assess business value and technical depth
4. Provide specific, actionable feedback for improvement
5. Score documentation across multiple quality dimensions
6. Ensure documentation meets business and technical standards

Quality Assessment Criteria:
- Completeness: Are all aspects of the code documented?
- Accuracy: Does the documentation correctly reflect the code?
- Clarity: Is the documentation clear and understandable?
- Business Value: Does it communicate business impact effectively?
- Technical Depth: Are technical details appropriately explained?
- Consistency: Is the documentation internally consistent?

Review Process:
1. Compare documentation against original code
2. Identify missing or inaccurate information
3. Assess business language and clarity
4. Check for completeness of all required sections
5. Evaluate metadata accuracy and completeness
6. Provide prioritized feedback for improvement

Focus Areas:
- Data lineage accuracy
- Business rule completeness
- Column metadata accuracy
- Process flow clarity
- KPI definitions and calculations
- Integration and dependency documentation

Always provide constructive, specific feedback with clear improvement suggestions.`,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2, // Lower temperature for more consistent reviews
      maxTokens: 3000,
      enableRAG: true,
      ragOptions: {
        includeDocuments: true,
        includeCode: false, // Focus on documentation examples
        includeQA: true,
        maxTokens: 2000,
        minScore: 0.75
      }
    };

    super(config);
  }

  protected async onMessageReceived(message: AgentMessage): Promise<void> {
    const content = message.content as Record<string, unknown>;
    const { action, input, workflowId: _workflowId, stepId } = content;

    try {
      let result;
      
      switch (action) {
        case 'review_documentation':
          result = await this.reviewDocumentation(input as ReviewInput);
          break;
        case 'final_review':
          result = await this.finalReview(input as ReviewInput);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Send response back to orchestrator
      await this.sendMessage(message.from, 'response', result, { stepId });
      
    } catch (error) {
      await this.sendMessage(message.from, 'response', {
        error: error instanceof Error ? error.message : 'Unknown error'
      }, { stepId });
    }
  }

  async execute(input: ReviewInput): Promise<ReviewFeedback> {
    return await this.reviewDocumentation(input);
  }

  // Review documentation and provide feedback
  private async reviewDocumentation(input: ReviewInput): Promise<ReviewFeedback> {
    // Get RAG context for documentation examples
    const ragContext = await this.getRAGContext(
      `Review documentation for ${input.filename}. Focus on documentation quality and completeness.`
    );

    // Build review prompt
    const prompt = this.buildReviewPrompt(input, ragContext);

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const response = await this.generateCompletion(messages);
    
    try {
      const feedback = JSON.parse(response) as ReviewFeedback;
      this.validateFeedback(feedback);
      return feedback;
    } catch (error) {
      throw new Error(`Failed to parse review feedback: ${error}`);
    }
  }

  // Perform final review
  private async finalReview(input: ReviewInput): Promise<ReviewFeedback> {
    // Get RAG context for final review standards
    const ragContext = await this.getRAGContext(
      `Final review standards for ${input.filename}. Focus on approval criteria.`
    );

    // Build final review prompt
    const prompt = this.buildFinalReviewPrompt(input, ragContext);

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const response = await this.generateCompletion(messages);
    
    try {
      const feedback = JSON.parse(response) as ReviewFeedback;
      this.validateFeedback(feedback);
      return feedback;
    } catch (error) {
      throw new Error(`Failed to parse final review feedback: ${error}`);
    }
  }

  // Build review prompt
  private buildReviewPrompt(input: ReviewInput, ragContext: string): string {
    let prompt = `Please conduct a comprehensive review of the following documentation.

## Original Python Code:
\`\`\`python
${input.originalCode}
\`\`\`

## Generated Documentation:
${JSON.stringify(input.documentation, null, 2)}

## Filename: ${input.filename}

`;

    if (input.excelContext) {
      prompt += `## Excel Context:
${input.excelContext}

`;
    }

    if (input.existingDocs) {
      prompt += `## Existing Documentation:
${input.existingDocs}

`;
    }

    if (ragContext) {
      prompt += `## Documentation Standards and Examples:
${ragContext}

`;
    }

    prompt += `## Review Requirements:
1. Compare the documentation against the original Python code
2. Assess completeness across all required sections
3. Evaluate accuracy of technical details
4. Check clarity and business language
5. Verify metadata completeness and accuracy
6. Assess business value communication
7. Identify any gaps or inconsistencies

## Quality Scoring (1-10):
- Completeness: All aspects covered?
- Accuracy: Correct representation of code?
- Clarity: Clear and understandable?
- Business Value: Communicates impact effectively?
- Technical Depth: Appropriate technical detail?
- Consistency: Internally consistent?

## Focus Areas:
- Data source identification and description
- Table grain accuracy
- Column metadata completeness
- Business rule coverage
- Process flow clarity
- KPI definitions
- Integration documentation

## Output Format:
Return ONLY a valid JSON object with the following structure:
{
  "overallScore": 8,
  "needsImprovement": false,
  "strengths": ["List of strengths"],
  "weaknesses": ["List of weaknesses"],
  "suggestions": ["List of improvement suggestions"],
  "specificIssues": {
    "description": ["Issues with description"],
    "tableGrain": ["Issues with table grain"],
    "dataSources": ["Issues with data sources"],
    "databricksTables": ["Issues with databricks tables"],
    "tableMetadata": ["Issues with table metadata"],
    "integratedRules": ["Issues with integrated rules"],
    "processFlow": ["Issues with process flow"],
    "kpis": ["Issues with KPIs"]
  },
  "priorityFixes": [
    {
      "issue": "Specific issue description",
      "priority": "high",
      "suggestion": "Specific fix suggestion"
    }
  ]
}

Set needsImprovement to true if overall score is below 7 or if there are any high-priority issues.`;

    return prompt;
  }

  // Build final review prompt
  private buildFinalReviewPrompt(input: ReviewInput, ragContext: string): string {
    let prompt = `Please conduct a FINAL REVIEW of the following documentation for approval.

## Original Python Code:
\`\`\`python
${input.originalCode}
\`\`\`

## Documentation for Final Review:
${JSON.stringify(input.documentation, null, 2)}

## Filename: ${input.filename}

`;

    if (ragContext) {
      prompt += `## Final Review Standards:
${ragContext}

`;
    }

    prompt += `## Final Review Criteria:
This is the final review before approval. The documentation should:
1. Accurately represent the Python code
2. Be complete across all required sections
3. Use clear, business-friendly language
4. Provide comprehensive metadata
5. Include all necessary business rules
6. Have a clear process flow
7. Score 7 or above overall

## Approval Threshold:
- Overall score must be 7 or higher
- No high-priority issues
- All critical sections must be complete and accurate

## Output Format:
Return ONLY a valid JSON object with the final review feedback.
Set needsImprovement to false ONLY if the documentation is ready for approval.`;

    return prompt;
  }

  // Validate feedback structure
  private validateFeedback(feedback: ReviewFeedback): void {
    const requiredFields = [
      'overallScore',
      'needsImprovement',
      'strengths',
      'weaknesses',
      'suggestions',
      'specificIssues',
      'priorityFixes'
    ];

    for (const field of requiredFields) {
      if (!(field in feedback)) {
        throw new Error(`Missing required field in feedback: ${field}`);
      }
    }

    // Validate score range
    if (feedback.overallScore < 1 || feedback.overallScore > 10) {
      throw new Error('Overall score must be between 1 and 10');
    }

    // Validate arrays
    if (!Array.isArray(feedback.strengths)) {
      throw new Error('Strengths must be an array');
    }

    if (!Array.isArray(feedback.weaknesses)) {
      throw new Error('Weaknesses must be an array');
    }

    if (!Array.isArray(feedback.suggestions)) {
      throw new Error('Suggestions must be an array');
    }

    if (!Array.isArray(feedback.priorityFixes)) {
      throw new Error('Priority fixes must be an array');
    }

    // Validate priority fixes structure
    for (const fix of feedback.priorityFixes) {
      if (!fix.issue || !fix.priority || !fix.suggestion) {
        throw new Error('Invalid priority fix structure');
      }
      
      if (!['high', 'medium', 'low'].includes(fix.priority)) {
        throw new Error('Invalid priority level');
      }
    }
  }

  // Calculate quality metrics
  calculateQualityMetrics(feedback: ReviewFeedback): QualityMetrics {
    const baseScore = feedback.overallScore;
    const highPriorityIssues = feedback.priorityFixes.filter(fix => fix.priority === 'high').length;
    const mediumPriorityIssues = feedback.priorityFixes.filter(fix => fix.priority === 'medium').length;
    
    // Calculate individual metrics (simplified algorithm)
    const completeness = Math.max(1, baseScore - (highPriorityIssues * 2) - (mediumPriorityIssues * 1));
    const accuracy = Math.max(1, baseScore - (highPriorityIssues * 1.5));
    const clarity = Math.max(1, baseScore - (feedback.weaknesses.length * 0.5));
    const businessValue = Math.max(1, baseScore - (highPriorityIssues * 1));
    const technicalDepth = Math.max(1, baseScore - (mediumPriorityIssues * 0.5));
    const consistency = Math.max(1, baseScore - (feedback.priorityFixes.length * 0.3));

    return {
      completeness: Math.min(10, completeness),
      accuracy: Math.min(10, accuracy),
      clarity: Math.min(10, clarity),
      businessValue: Math.min(10, businessValue),
      technicalDepth: Math.min(10, technicalDepth),
      consistency: Math.min(10, consistency)
    };
  }

  // Generate improvement summary
  generateImprovementSummary(feedback: ReviewFeedback): string {
    const metrics = this.calculateQualityMetrics(feedback);
    
    let summary = `## Documentation Review Summary\n\n`;
    summary += `**Overall Score:** ${feedback.overallScore}/10\n`;
    summary += `**Status:** ${feedback.needsImprovement ? 'Needs Improvement' : 'Approved'}\n\n`;
    
    summary += `### Quality Metrics:\n`;
    summary += `- Completeness: ${metrics.completeness.toFixed(1)}/10\n`;
    summary += `- Accuracy: ${metrics.accuracy.toFixed(1)}/10\n`;
    summary += `- Clarity: ${metrics.clarity.toFixed(1)}/10\n`;
    summary += `- Business Value: ${metrics.businessValue.toFixed(1)}/10\n`;
    summary += `- Technical Depth: ${metrics.technicalDepth.toFixed(1)}/10\n`;
    summary += `- Consistency: ${metrics.consistency.toFixed(1)}/10\n\n`;
    
    if (feedback.strengths.length > 0) {
      summary += `### Strengths:\n`;
      feedback.strengths.forEach(strength => {
        summary += `- ${strength}\n`;
      });
      summary += `\n`;
    }
    
    if (feedback.weaknesses.length > 0) {
      summary += `### Areas for Improvement:\n`;
      feedback.weaknesses.forEach(weakness => {
        summary += `- ${weakness}\n`;
      });
      summary += `\n`;
    }
    
    if (feedback.priorityFixes.length > 0) {
      summary += `### Priority Fixes:\n`;
      feedback.priorityFixes.forEach(fix => {
        summary += `- **${fix.priority.toUpperCase()}**: ${fix.issue}\n`;
        summary += `  *Suggestion: ${fix.suggestion}*\n`;
      });
    }
    
    return summary;
  }
}