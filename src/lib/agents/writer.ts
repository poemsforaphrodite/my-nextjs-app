import { BaseAgent, AgentConfig, AgentMessage } from './base';

export interface DocumentationInput {
  pythonCode: string;
  filename: string;
  excelContext?: string;
  existingDocs?: string;
  userPreferences?: Record<string, unknown>;
  ragContext?: string;
}

export interface RefinementInput {
  feedback: Record<string, unknown>;
  previousDraft: Record<string, unknown>;
  originalInput: DocumentationInput;
}

export interface Documentation {
  description: string;
  tableGrain: string;
  dataSources: string[];
  databricksTables: string[];
  tableMetadata: Array<{
    tableName: string;
    columns: Array<{
      name: string;
      type: string;
      description: string;
    }>;
  }>;
  integratedRules: string[];
  processFlow?: {
    overview: string;
    steps: Array<{
      stepNumber: number;
      description: string;
      inputSources: string[];
      joinConditions: string[];
      businessDefinitions: string[];
    }>;
  };
  kpis?: Array<{
    name: string;
    definition: string;
    calculation: string;
  }>;
}

export class WriterAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      name: 'writer',
      description: 'Generates comprehensive documentation for Python code with RAG-enhanced context',
      systemPrompt: `You are a specialized documentation writer that creates comprehensive business documentation for Python data pipeline code.

Your core responsibilities:
1. Analyze Python code to understand data processing logic
2. Use retrieved context from similar documentation and code examples
3. Generate structured documentation following the business template
4. Incorporate Excel context and existing documentation when provided
5. Ensure all technical details are translated into business-friendly language

Documentation Structure:
- Description: Clear business purpose of the code
- Table Grain: Unique combination of columns that defines data granularity
- Data Sources: Input datasets and their business context
- Databricks Tables: Output tables and their purpose
- Table Metadata: Column definitions with business meaning
- Integrated Rules: Business rules and validation logic
- Process Flow: Step-by-step data transformation process
- KPIs: Key performance indicators and calculated fields

Focus on:
- Business value and impact
- Data lineage and dependencies
- Transformation logic explanation
- Quality and validation rules
- Performance considerations

Always use the retrieved context to enhance your documentation with relevant examples, patterns, and best practices.`,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 4000,
      enableRAG: true,
      ragOptions: {
        includeDocuments: true,
        includeCode: true,
        includeQA: true,
        maxTokens: 3000,
        minScore: 0.7
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
        case 'generate_documentation':
          result = await this.generateDocumentation(input as DocumentationInput);
          break;
        case 'refine_documentation':
          result = await this.refineDocumentation(input as RefinementInput);
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

  async execute(input: DocumentationInput): Promise<Documentation> {
    return await this.generateDocumentation(input);
  }

  // Generate initial documentation
  private async generateDocumentation(input: DocumentationInput): Promise<Documentation> {
    // Get RAG context for the Python code
    const ragContext = await this.getRAGContext(
      `${input.pythonCode}\n\nFilename: ${input.filename}`
    );

    // Build the prompt with all available context
    const prompt = this.buildDocumentationPrompt(input, ragContext);

    // Generate documentation using OpenAI
    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const response = await this.generateCompletion(messages);
    
    try {
      // Parse the JSON response
      const documentation = JSON.parse(response) as Documentation;
      
      // Validate the documentation structure
      this.validateDocumentation(documentation);
      
      return documentation;
    } catch (error) {
      throw new Error(`Failed to parse documentation: ${error}`);
    }
  }

  // Refine documentation based on feedback
  private async refineDocumentation(input: RefinementInput): Promise<Documentation> {
    const { feedback, previousDraft, originalInput } = input;

    // Get fresh RAG context
    const ragContext = await this.getRAGContext(
      `${originalInput.pythonCode}\n\nFilename: ${originalInput.filename}\n\nFeedback: ${JSON.stringify(feedback)}`
    );

    // Build refinement prompt
    const prompt = this.buildRefinementPrompt(originalInput, previousDraft as unknown as Documentation, feedback, ragContext);

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const response = await this.generateCompletion(messages);
    
    try {
      const refinedDocumentation = JSON.parse(response) as Documentation;
      this.validateDocumentation(refinedDocumentation);
      return refinedDocumentation;
    } catch (error) {
      throw new Error(`Failed to parse refined documentation: ${error}`);
    }
  }

  // Build documentation prompt
  private buildDocumentationPrompt(input: DocumentationInput, ragContext: string): string {
    let prompt = `Please analyze the following Python code and generate comprehensive business documentation.

## Python Code to Document:
\`\`\`python
${input.pythonCode}
\`\`\`

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
      prompt += `## Retrieved Context (Examples and Patterns):
${ragContext}

`;
    }

    if (input.userPreferences) {
      prompt += `## User Preferences:
${JSON.stringify(input.userPreferences, null, 2)}

`;
    }

    prompt += `## Requirements:
1. Generate documentation following the exact JSON structure provided in the system prompt
2. Focus on business value and data transformation logic
3. Use the retrieved context to enhance explanations with relevant examples
4. Translate technical code into business-friendly language
5. Include comprehensive table metadata with business column descriptions
6. Identify and document all data sources and outputs
7. Explain the business rules and validation logic
8. Provide clear process flow with step-by-step transformation logic

## Output Format:
Return ONLY a valid JSON object with the following structure:
{
  "description": "Business purpose and overview",
  "tableGrain": "Unique combination of columns that defines data granularity",
  "dataSources": ["List of input data sources"],
  "databricksTables": ["List of output tables"],
  "tableMetadata": [
    {
      "tableName": "table_name",
      "columns": [
        {
          "name": "column_name",
          "type": "data_type",
          "description": "Business description"
        }
      ]
    }
  ],
  "integratedRules": ["List of business rules and validations"],
  "processFlow": {
    "overview": "High-level process description",
    "steps": [
      {
        "stepNumber": 1,
        "description": "Step description",
        "inputSources": ["input sources"],
        "joinConditions": ["join conditions"],
        "businessDefinitions": ["business definitions"]
      }
    ]
  },
  "kpis": [
    {
      "name": "KPI name",
      "definition": "Business definition",
      "calculation": "Calculation logic"
    }
  ]
}`;

    return prompt;
  }

  // Build refinement prompt
  private buildRefinementPrompt(
    originalInput: DocumentationInput,
    previousDraft: Documentation,
    feedback: Record<string, unknown>,
    ragContext: string
  ): string {
    let prompt = `Please refine the following documentation based on the provided feedback.

## Original Python Code:
\`\`\`python
${originalInput.pythonCode}
\`\`\`

## Previous Documentation Draft:
${JSON.stringify(previousDraft, null, 2)}

## Feedback for Improvement:
${JSON.stringify(feedback, null, 2)}

`;

    if (ragContext) {
      prompt += `## Retrieved Context (Examples and Patterns):
${ragContext}

`;
    }

    prompt += `## Requirements:
1. Address all feedback points specifically
2. Maintain the JSON structure while improving content
3. Use the retrieved context to enhance explanations
4. Ensure all business requirements are met
5. Improve clarity and completeness based on feedback
6. Maintain consistency with the original code analysis

## Output Format:
Return ONLY a valid JSON object with the improved documentation following the same structure as the previous draft.`;

    return prompt;
  }

  // Validate documentation structure
  private validateDocumentation(doc: Documentation): void {
    const requiredFields = [
      'description',
      'tableGrain',
      'dataSources',
      'databricksTables',
      'tableMetadata',
      'integratedRules'
    ];

    for (const field of requiredFields) {
      if (!(field in doc)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate arrays
    if (!Array.isArray(doc.dataSources)) {
      throw new Error('dataSources must be an array');
    }

    if (!Array.isArray(doc.databricksTables)) {
      throw new Error('databricksTables must be an array');
    }

    if (!Array.isArray(doc.tableMetadata)) {
      throw new Error('tableMetadata must be an array');
    }

    if (!Array.isArray(doc.integratedRules)) {
      throw new Error('integratedRules must be an array');
    }

    // Validate table metadata structure
    for (const table of doc.tableMetadata) {
      if (!table.tableName || !Array.isArray(table.columns)) {
        throw new Error('Invalid table metadata structure');
      }
      
      for (const column of table.columns) {
        if (!column.name || !column.type || !column.description) {
          throw new Error('Invalid column structure in table metadata');
        }
      }
    }
  }

  // Generate streaming documentation (for real-time updates)
  async generateStreamingDocumentation(
    input: DocumentationInput,
    onToken?: (token: string) => void
  ): Promise<Documentation> {
    const ragContext = await this.getRAGContext(
      `${input.pythonCode}\n\nFilename: ${input.filename}`
    );

    const prompt = this.buildDocumentationPrompt(input, ragContext);

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: prompt }
    ];

    const response = await this.generateStreamingCompletion(messages, onToken);
    
    try {
      const documentation = JSON.parse(response) as Documentation;
      this.validateDocumentation(documentation);
      return documentation;
    } catch (error) {
      throw new Error(`Failed to parse streamed documentation: ${error}`);
    }
  }
}