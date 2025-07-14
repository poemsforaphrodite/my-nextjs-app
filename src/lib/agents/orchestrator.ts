import { BaseAgent, AgentConfig, AgentMessage, agentRegistry } from './base';

export interface WorkflowStep {
  id: string;
  agent: string;
  action: string;
  input: unknown;
  output?: unknown;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string;
  timestamp?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  currentStep: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  metadata: Record<string, unknown>;
}

export interface DocumentGenerationTask {
  pythonCode: string;
  filename: string;
  excelContext?: string;
  existingDocs?: string;
  userPreferences?: Record<string, unknown>;
}

export class OrchestratorAgent extends BaseAgent {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private activeWorkflows: Set<string> = new Set();

  constructor() {
    const config: AgentConfig = {
      name: 'orchestrator',
      description: 'Coordinates multi-agent workflows for documentation generation',
      systemPrompt: `You are an orchestrator agent responsible for coordinating complex documentation generation workflows. 
      You manage the execution of multiple specialized agents including Writer, Critic, and Router agents.
      
      Your responsibilities:
      1. Create and manage workflow definitions
      2. Coordinate agent interactions
      3. Handle error recovery and retries
      4. Provide progress updates
      5. Ensure quality through iterative improvement
      
      Always maintain workflow state and provide detailed progress information.`,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 2000,
      enableRAG: true,
      ragOptions: {
        includeDocuments: true,
        includeCode: true,
        includeQA: true,
        maxTokens: 2000,
        minScore: 0.7
      }
    };

    super(config);
  }

  protected async onMessageReceived(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case 'response':
        await this.handleAgentResponse(message);
        break;
      case 'feedback':
        await this.handleFeedback(message);
        break;
      case 'status':
        await this.handleStatusUpdate(message);
        break;
      default:
        console.log(`Orchestrator received unknown message type: ${message.type}`);
    }
  }

  // Main execution method
  async execute(input: DocumentGenerationTask): Promise<unknown> {
    const workflowId = `workflow-${Date.now()}`;
    
    // Create workflow definition for documentation generation
    const workflow = this.createDocumentationWorkflow(workflowId, input);
    this.workflows.set(workflowId, workflow);
    this.activeWorkflows.add(workflowId);

    try {
      // Execute workflow
      const result = await this.executeWorkflow(workflowId);
      
      // Update workflow status
      workflow.status = 'completed';
      this.activeWorkflows.delete(workflowId);
      
      return result;
    } catch (error) {
      // Handle workflow failure
      workflow.status = 'failed';
      this.activeWorkflows.delete(workflowId);
      throw error;
    }
  }

  // Create documentation generation workflow
  private createDocumentationWorkflow(
    workflowId: string, 
    input: DocumentGenerationTask
  ): WorkflowDefinition {
    const steps: WorkflowStep[] = [
      {
        id: 'retrieve_context',
        agent: 'orchestrator',
        action: 'retrieve_relevant_context',
        input: { query: input.pythonCode, filename: input.filename },
        status: 'pending'
      },
      {
        id: 'generate_draft',
        agent: 'writer',
        action: 'generate_documentation',
        input: {
          pythonCode: input.pythonCode,
          filename: input.filename,
          excelContext: input.excelContext,
          existingDocs: input.existingDocs,
          userPreferences: input.userPreferences
        },
        status: 'pending'
      },
      {
        id: 'review_draft',
        agent: 'critic',
        action: 'review_documentation',
        input: {}, // Will be populated with draft from previous step
        status: 'pending'
      },
      {
        id: 'refine_documentation',
        agent: 'writer',
        action: 'refine_documentation',
        input: {}, // Will be populated with feedback from critic
        status: 'pending'
      },
      {
        id: 'final_review',
        agent: 'critic',
        action: 'final_review',
        input: {}, // Will be populated with refined documentation
        status: 'pending'
      }
    ];

    return {
      id: workflowId,
      name: 'Documentation Generation',
      description: `Generate documentation for ${input.filename}`,
      steps,
      currentStep: 0,
      status: 'pending',
      metadata: {
        filename: input.filename,
        startTime: Date.now(),
        maxIterations: 3,
        currentIteration: 1
      }
    };
  }

  // Execute workflow
  private async executeWorkflow(workflowId: string): Promise<unknown> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.status = 'in_progress';
    let iterationCount = 0;
    const maxIterations = (workflow.metadata.maxIterations as number) || 3;

    while (workflow.currentStep < workflow.steps.length && iterationCount < maxIterations) {
      const step = workflow.steps[workflow.currentStep];
      
      try {
        // Execute current step
        const result = await this.executeStep(workflow, step);
        
        // Update step status
        step.output = result;
        step.status = 'completed';
        step.timestamp = Date.now();
        
        // Handle step-specific logic
        if (step.id === 'review_draft' || step.id === 'final_review') {
          const stepResult = result as { feedback: { needsImprovement: boolean } };
          const feedback = stepResult.feedback;
          
          if (feedback.needsImprovement && iterationCount < maxIterations - 1) {
            // Need to iterate - go back to refinement step
            workflow.currentStep = workflow.steps.findIndex(s => s.id === 'refine_documentation');
            iterationCount++;
            workflow.metadata.currentIteration = iterationCount + 1;
            
            // Update refinement step input with feedback
            const refineStep = workflow.steps[workflow.currentStep];
            const stepInput = step.input as { documentation: unknown };
            refineStep.input = {
              ...(refineStep.input as Record<string, unknown>),
              feedback: feedback,
              previousDraft: stepInput.documentation
            };
            refineStep.status = 'pending';
            
            continue;
          }
        }
        
        // Move to next step
        workflow.currentStep++;
        
      } catch (error) {
        // Handle step failure
        step.status = 'failed';
        step.error = error instanceof Error ? error.message : 'Unknown error';
        step.timestamp = Date.now();
        
        // Attempt retry or fail workflow
        if (this.shouldRetryStep(step)) {
          step.status = 'pending';
          continue;
        } else {
          throw error;
        }
      }
    }

    // Return final result
    const finalStep = workflow.steps[workflow.steps.length - 1];
    return finalStep.output;
  }

  // Execute individual workflow step
  private async executeStep(workflow: WorkflowDefinition, step: WorkflowStep): Promise<unknown> {
    step.status = 'in_progress';
    
    // Send status update
    await this.sendMessage('status', 'status', {
      workflowId: workflow.id,
      stepId: step.id,
      status: step.status,
      progress: (workflow.currentStep + 1) / workflow.steps.length
    });

    if (step.agent === 'orchestrator') {
      // Handle orchestrator actions
      return await this.handleOrchestratorAction(step);
    } else {
      // Delegate to other agents
      const targetAgent = agentRegistry.get(step.agent);
      if (!targetAgent) {
        throw new Error(`Agent ${step.agent} not found`);
      }

      // Send request to target agent
      await this.sendMessage(step.agent, 'request', {
        action: step.action,
        input: step.input,
        workflowId: workflow.id,
        stepId: step.id
      });

      // Wait for response (simplified - in real implementation would use proper async handling)
      return await this.waitForAgentResponse(step.agent, step.id);
    }
  }

  // Handle orchestrator-specific actions
  private async handleOrchestratorAction(step: WorkflowStep): Promise<unknown> {
    switch (step.action) {
      case 'retrieve_relevant_context':
        const stepInput = step.input as { query: string };
        const context = await this.getRAGContext(stepInput.query);
        return { context };
      
      default:
        throw new Error(`Unknown orchestrator action: ${step.action}`);
    }
  }

  // Wait for agent response
  private async waitForAgentResponse(agentName: string, stepId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for response from ${agentName}`));
      }, 30000); // 30 second timeout

      const checkForResponse = () => {
        const responseMessage = this.context.messages.find(
          msg => msg.from === agentName && 
                 msg.type === 'response' && 
                 msg.metadata?.stepId === stepId
        );

        if (responseMessage) {
          clearTimeout(timeout);
          resolve(responseMessage.content);
        } else {
          setTimeout(checkForResponse, 100);
        }
      };

      checkForResponse();
    });
  }

  // Handle agent response
  private async handleAgentResponse(message: AgentMessage): Promise<void> {
    // Response handling is done in waitForAgentResponse
    // This method can be used for additional processing if needed
  }

  // Handle feedback
  private async handleFeedback(message: AgentMessage): Promise<void> {
    // Process feedback and update workflow if needed
    console.log(`Received feedback: ${JSON.stringify(message.content)}`);
  }

  // Handle status updates
  private async handleStatusUpdate(message: AgentMessage): Promise<void> {
    // Process status updates from other agents
    console.log(`Status update from ${message.from}: ${JSON.stringify(message.content)}`);
  }

  // Determine if step should be retried
  private shouldRetryStep(step: WorkflowStep): boolean {
    // Simple retry logic - can be enhanced
    return false;
  }

  // Get workflow status
  getWorkflowStatus(workflowId: string): WorkflowDefinition | null {
    return this.workflows.get(workflowId) || null;
  }

  // Get all active workflows
  getActiveWorkflows(): WorkflowDefinition[] {
    return Array.from(this.activeWorkflows).map(id => this.workflows.get(id)!);
  }

  // Cancel workflow
  async cancelWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      workflow.status = 'failed';
      this.activeWorkflows.delete(workflowId);
    }
  }
}