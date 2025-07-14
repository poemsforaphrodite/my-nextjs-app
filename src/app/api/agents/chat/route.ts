import { NextRequest, NextResponse } from 'next/server';
import { RouterAgent } from '@/lib/agents/router';
import { AnswerAgent } from '@/lib/agents/answer';
import { RegenerateAgent } from '@/lib/agents/regenerate';
import { agentRegistry } from '@/lib/agents/base';

export const maxDuration = 30; // 30 seconds for chat responses

// Initialize agents
const router = new RouterAgent();
const answer = new AnswerAgent();
const regenerate = new RegenerateAgent();

// Register agents
agentRegistry.register(router);
agentRegistry.register(answer);
agentRegistry.register(regenerate);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      query, 
      context, 
      sessionId = `session-${Date.now()}`,
      userId 
    } = body;

    // Validate required fields
    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Check if streaming is requested
    const wantsStreaming = request.headers.get('accept') === 'text/event-stream';

    if (wantsStreaming) {
      // Return streaming response
      return handleStreamingChat({
        question: query,
        sessionId,
        conversationHistory: context.conversationHistory,
        context: context
      });
    } else {
      // Return regular JSON response
      const result = await router.execute({
        query,
        context: {
          ...context,
          sessionId,
          userId
        }
      });

      return NextResponse.json(result);
    }
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    );
  }
}

// Handle streaming chat
async function handleStreamingChat(input: { question: string; sessionId?: string; conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>; context?: { hasDocumentation?: boolean; filename?: string; documentation?: Record<string, unknown> } }) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
    try {
      // Send initial status
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'status',
          message: 'Processing your question...'
        })}\n\n`)
      );

      // Route the query first
      const classification = await router.classifyQuery({
        query: input.question,
        context: {
          sessionId: input.sessionId,
          conversationHistory: input.conversationHistory,
          hasDocumentation: input.context?.hasDocumentation,
          filename: input.context?.filename,
          documentation: input.context?.documentation
        }
      });
      
      // Send classification info
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: 'classification',
          intent: classification.intent,
          confidence: classification.confidence,
          agent: classification.suggestedAgent
        })}\n\n`)
      );

      // Route to appropriate agent
      if (classification.intent === 'ask-doc') {
        // Use answer agent for Q&A
        const answerInput = {
          question: input.question,
          context: {
            sessionId: input.sessionId,
            conversationHistory: input.conversationHistory,
            hasDocumentation: input.context?.hasDocumentation,
            filename: input.context?.filename,
            documentation: input.context?.documentation
          },
          entities: classification.extractedEntities
        };

        // Stream the answer
        const answerResponse = await answer.generateStreamingAnswer(
          answerInput,
          (token) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                type: 'token',
                token
              })}\n\n`)
            );
          }
        );

        // Send final answer metadata
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: 'answer_metadata',
            confidence: answerResponse.confidence,
            sources: answerResponse.sources,
            suggestedFollowUp: answerResponse.suggestedFollowUp,
            needsMoreInfo: answerResponse.needsMoreInfo,
            clarifyingQuestions: answerResponse.clarifyingQuestions
          })}\n\n`)
        );

      } else if (classification.intent === 'improve-doc') {
        // Use regenerate agent for documentation improvement
        const regenerateInput = {
          userFeedback: input.question,
          context: {
            sessionId: input.sessionId,
            conversationHistory: input.conversationHistory,
            hasDocumentation: input.context?.hasDocumentation,
            filename: input.context?.filename,
            documentation: input.context?.documentation
          },
          entities: classification.extractedEntities
        };

        // Execute regeneration
        const regenerateResponse = await regenerate.execute(regenerateInput);

        // Send the regeneration response
        if (regenerateResponse.success) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'token',
              token: regenerateResponse.message
            })}\n\n`)
          );

          if (regenerateResponse.updatedDocumentation) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                type: 'documentation_updated',
                documentation: regenerateResponse.updatedDocumentation
              })}\n\n`)
            );
          }
        } else {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'token',
              token: regenerateResponse.message
            })}\n\n`)
          );

          if (regenerateResponse.requiresFileUpload) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                type: 'requires_upload',
                message: 'Please upload your Python file to generate or improve documentation.'
              })}\n\n`)
            );
          }
        }

      } else if (classification.intent === 'generate-doc') {
        // Redirect to orchestration endpoint
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: 'redirect',
            endpoint: '/api/agents/orchestrate',
            message: 'This request requires documentation generation. Please use the orchestrate endpoint.',
            suggestion: 'Upload your Python file and use the documentation generation feature.'
          })}\n\n`)
        );

      } else if (classification.intent === 'unknown') {
        // Handle unknown intent
        const alternatives = await router.suggestAlternatives(classification);
        
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            type: 'clarification',
            message: "I'm not sure how to help with that. Could you clarify what you're looking for?",
            alternatives,
            suggestedActions: [
              'Ask a question about existing documentation',
              'Upload a Python file for documentation generation',
              'Browse the knowledge base'
            ]
          })}\n\n`)
        );
      }

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

// Get chat history
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const userId = searchParams.get('userId');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  try {
    // In a real implementation, this would retrieve chat history from a database
    // For now, return empty history
    return NextResponse.json({
      sessionId,
      userId,
      messages: [],
      totalMessages: 0
    });
  } catch (error) {
    console.error('Error getting chat history:', error);
    return NextResponse.json(
      { error: 'Failed to get chat history' },
      { status: 500 }
    );
  }
}

// Store chat feedback
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, messageId, feedback } = body;

    if (!sessionId || !messageId || !feedback) {
      return NextResponse.json(
        { error: 'Session ID, message ID, and feedback are required' },
        { status: 400 }
      );
    }

    // Store feedback for learning
    await answer.storeFeedback(messageId, feedback);

    return NextResponse.json({ message: 'Feedback stored successfully' });
  } catch (error) {
    console.error('Error storing feedback:', error);
    return NextResponse.json(
      { error: 'Failed to store feedback' },
      { status: 500 }
    );
  }
}