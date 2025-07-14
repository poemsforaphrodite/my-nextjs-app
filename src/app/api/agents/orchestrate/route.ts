import { NextRequest, NextResponse } from 'next/server';
import { OrchestratorAgent } from '@/lib/agents/orchestrator';
import { WriterAgent } from '@/lib/agents/writer';
import { CriticAgent } from '@/lib/agents/critic';
import { agentRegistry } from '@/lib/agents/base';

export const maxDuration = 60; // 60 seconds for complex workflows

// Initialize agents
const orchestrator = new OrchestratorAgent();
const writer = new WriterAgent();
const critic = new CriticAgent();

// Register agents
agentRegistry.register(orchestrator);
agentRegistry.register(writer);
agentRegistry.register(critic);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pythonCode, filename, excelContext, existingDocs, userPreferences } = body;

    // Validate required fields
    if (!pythonCode || !filename) {
      return NextResponse.json(
        { error: 'Python code and filename are required' },
        { status: 400 }
      );
    }

    // Check if streaming is requested
    const wantsStreaming = request.headers.get('accept') === 'text/event-stream';

    if (wantsStreaming) {
      // Return streaming response
      return handleStreamingOrchestration({
        pythonCode,
        filename,
        excelContext,
        existingDocs,
        userPreferences
      });
    } else {
      // Return regular JSON response
      const result = await orchestrator.execute({
        pythonCode,
        filename,
        excelContext,
        existingDocs,
        userPreferences
      });

      return NextResponse.json(result);
    }
  } catch (error) {
    console.error('Orchestration error:', error);
    return NextResponse.json(
      { error: 'Failed to orchestrate documentation generation' },
      { status: 500 }
    );
  }
}

// Handle streaming orchestration
async function handleStreamingOrchestration(input: { pythonCode: string; filename: string; excelContext?: string; existingDocs?: string; userPreferences?: Record<string, unknown> }) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
    try {
      // Send initial status
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Starting documentation generation workflow...',
          progress: 0
        })}\n\n`)
      );

      // Create context for orchestrator
      const context = {
        sessionId: `session-${Date.now()}`,
        taskId: `task-${Date.now()}`,
        messages: [],
        sharedState: {}
      };

      await orchestrator.initialize(context);

      // Hook into orchestrator messages for progress updates
      const originalSendMessage = orchestrator.sendMessage.bind(orchestrator);
      orchestrator.sendMessage = async (to, type, content, metadata) => {
        // Send progress update
        if (type === 'status') {
          const statusContent = content as { stepId?: string; progress?: number; status?: string };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'progress',
              step: statusContent.stepId,
              progress: statusContent.progress,
              status: statusContent.status
            })}\n\n`)
          );
        }
        
        return originalSendMessage(to, type, content, metadata);
      };

      // Execute orchestration
      const result = await orchestrator.execute(input);

      // Send final result
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'result',
          data: result
        })}\n\n`)
      );

      // End stream
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();

    } catch (error) {
      // Send error
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`)
      );
      controller.close();
    }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Get workflow status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workflowId = searchParams.get('workflowId');

  if (!workflowId) {
    return NextResponse.json(
      { error: 'Workflow ID is required' },
      { status: 400 }
    );
  }

  try {
    const status = orchestrator.getWorkflowStatus(workflowId);
    
    if (!status) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(status);
  } catch (error) {
    console.error('Error getting workflow status:', error);
    return NextResponse.json(
      { error: 'Failed to get workflow status' },
      { status: 500 }
    );
  }
}

// Cancel workflow
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workflowId = searchParams.get('workflowId');

  if (!workflowId) {
    return NextResponse.json(
      { error: 'Workflow ID is required' },
      { status: 400 }
    );
  }

  try {
    await orchestrator.cancelWorkflow(workflowId);
    return NextResponse.json({ message: 'Workflow cancelled' });
  } catch (error) {
    console.error('Error cancelling workflow:', error);
    return NextResponse.json(
      { error: 'Failed to cancel workflow' },
      { status: 500 }
    );
  }
}