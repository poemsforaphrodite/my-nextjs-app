import { chunkQA } from './chunking';
import { embedAndStoreChunks } from './embeddings';
import './pinecone';

// Feedback types
export interface UserFeedback {
  id: string;
  type: 'documentation' | 'answer' | 'general';
  rating: number; // 1-5 scale
  helpful: boolean;
  accuracy?: number; // 1-5 scale
  completeness?: number; // 1-5 scale
  clarity?: number; // 1-5 scale
  comments?: string;
  context: {
    sessionId: string;
    userId?: string;
    originalQuery?: string;
    response?: string;
    timestamp: number;
  };
}

export interface DocumentationFeedback extends UserFeedback {
  type: 'documentation';
  documentationId: string;
  improvements: string[];
  missingInfo: string[];
}

export interface AnswerFeedback extends UserFeedback {
  type: 'answer';
  questionId: string;
  correctAnswer?: string;
  sources?: Array<{
    source: string;
    relevant: boolean;
    accurate: boolean;
  }>;
}

// Feedback storage and processing
export class FeedbackLoop {
  private feedbackStore: Map<string, UserFeedback> = new Map();
  private learningQueue: UserFeedback[] = [];
  private processingActive = false;

  // Store user feedback
  async storeFeedback(feedback: UserFeedback): Promise<void> {
    // Store in memory (in production, this would be a database)
    this.feedbackStore.set(feedback.id, feedback);
    
    // Add to learning queue if feedback is actionable
    if (this.isActionableFeedback(feedback)) {
      this.learningQueue.push(feedback);
    }
    
    // Process learning queue
    await this.processLearningQueue();
  }

  // Check if feedback is actionable for learning
  private isActionableFeedback(feedback: UserFeedback): boolean {
    // High-value feedback criteria
    if (feedback.rating <= 2 && feedback.comments) {
      return true; // Low rating with comments
    }
    
    if (feedback.type === 'answer' && (feedback as AnswerFeedback).correctAnswer) {
      return true; // Answer feedback with correct answer
    }
    
    if (feedback.type === 'documentation' && (feedback as DocumentationFeedback).improvements.length > 0) {
      return true; // Documentation feedback with improvements
    }
    
    return false;
  }

  // Process learning queue
  async processLearningQueue(): Promise<void> {
    if (this.processingActive || this.learningQueue.length === 0) {
      return;
    }

    this.processingActive = true;

    try {
      while (this.learningQueue.length > 0) {
        const feedback = this.learningQueue.shift()!;
        await this.processFeedback(feedback);
      }
    } catch (error) {
      console.error('Error processing learning queue:', error);
    } finally {
      this.processingActive = false;
    }
  }

  // Process individual feedback for learning
  private async processFeedback(feedback: UserFeedback): Promise<void> {
    switch (feedback.type) {
      case 'answer':
        await this.processAnswerFeedback(feedback as AnswerFeedback);
        break;
      case 'documentation':
        await this.processDocumentationFeedback(feedback as DocumentationFeedback);
        break;
      default:
        await this.processGeneralFeedback(feedback);
    }
  }

  // Process answer feedback
  private async processAnswerFeedback(feedback: AnswerFeedback): Promise<void> {
    if (!feedback.context.originalQuery) return;

    // Create improved Q&A pair if correct answer provided
    if (feedback.correctAnswer) {
      const qaChunks = chunkQA(
        feedback.context.originalQuery,
        feedback.correctAnswer,
        `feedback-${feedback.id}`,
        { chunkType: 'qa' }
      );

      // Add feedback metadata
      qaChunks.forEach(chunk => {
        chunk.metadata = {
          ...chunk.metadata,
          feedbackId: feedback.id,
          userImproved: true,
          originalRating: feedback.rating,
          improvementType: 'user_correction'
        };
      });

      // Store in knowledge base
      await embedAndStoreChunks(qaChunks);
    }

    // Store negative feedback for source quality assessment
    if (feedback.sources && feedback.rating <= 2) {
      await this.updateSourceQuality(feedback.sources);
    }
  }

  // Process documentation feedback
  private async processDocumentationFeedback(feedback: DocumentationFeedback): Promise<void> {
    if (feedback.improvements.length === 0) return;

    // Create improvement suggestions as knowledge base entries
    const improvementContent = `
Documentation Improvements for ${feedback.documentationId}:

User Feedback (Rating: ${feedback.rating}/5):
${feedback.comments || 'No additional comments'}

Suggested Improvements:
${feedback.improvements.map(imp => `- ${imp}`).join('\n')}

Missing Information:
${feedback.missingInfo.map(info => `- ${info}`).join('\n')}
    `.trim();

    const chunks = chunkQA(
      `How to improve documentation for ${feedback.documentationId}?`,
      improvementContent,
      `feedback-doc-${feedback.id}`,
      { chunkType: 'qa' }
    );

    // Add feedback metadata
    chunks.forEach(chunk => {
      chunk.metadata = {
        ...chunk.metadata,
        feedbackId: feedback.id,
        documentationId: feedback.documentationId,
        feedbackType: 'documentation_improvement',
        userRating: feedback.rating
      };
    });

    await embedAndStoreChunks(chunks);
  }

  // Process general feedback
  private async processGeneralFeedback(feedback: UserFeedback): Promise<void> {
    // Store general feedback as system knowledge
    if (feedback.comments && feedback.rating <= 2) {
      const feedbackContent = `
User Feedback (Rating: ${feedback.rating}/5):
Context: ${feedback.context.originalQuery || 'General system feedback'}
Comments: ${feedback.comments}
Session: ${feedback.context.sessionId}
Timestamp: ${new Date(feedback.context.timestamp).toISOString()}
      `.trim();

      const chunks = chunkQA(
        'What issues have users reported with the system?',
        feedbackContent,
        `feedback-general-${feedback.id}`,
        { chunkType: 'qa' }
      );

      chunks.forEach(chunk => {
        chunk.metadata = {
          ...chunk.metadata,
          feedbackId: feedback.id,
          feedbackType: 'general_issue',
          userRating: feedback.rating
        };
      });

      await embedAndStoreChunks(chunks);
    }
  }

  // Update source quality based on feedback
  private async updateSourceQuality(sources: AnswerFeedback['sources']): Promise<void> {
    if (!sources) return;

    for (const source of sources) {
      // In a real implementation, this would update source quality scores
      // For now, we'll log the feedback
      console.log(`Source quality feedback for ${source.source}:`, {
        relevant: source.relevant,
        accurate: source.accurate
      });
    }
  }

  // Get feedback analytics
  getFeedbackAnalytics(): {
    totalFeedback: number;
    averageRating: number;
    feedbackByType: Record<string, number>;
    recentFeedback: UserFeedback[];
    learningProgress: {
      queueSize: number;
      processed: number;
      actionableFeedback: number;
    };
  } {
    const allFeedback = Array.from(this.feedbackStore.values());
    const totalFeedback = allFeedback.length;
    const averageRating = totalFeedback > 0 
      ? allFeedback.reduce((sum, f) => sum + f.rating, 0) / totalFeedback 
      : 0;

    const feedbackByType = allFeedback.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const recentFeedback = allFeedback
      .sort((a, b) => b.context.timestamp - a.context.timestamp)
      .slice(0, 10);

    const actionableFeedback = allFeedback.filter(f => this.isActionableFeedback(f)).length;

    return {
      totalFeedback,
      averageRating,
      feedbackByType,
      recentFeedback,
      learningProgress: {
        queueSize: this.learningQueue.length,
        processed: actionableFeedback,
        actionableFeedback
      }
    };
  }

  // Get feedback for specific item
  getFeedbackForItem(itemId: string, type: string): UserFeedback[] {
    return Array.from(this.feedbackStore.values()).filter(f => {
      if (type === 'documentation' && f.type === 'documentation') {
        return (f as DocumentationFeedback).documentationId === itemId;
      }
      if (type === 'answer' && f.type === 'answer') {
        return (f as AnswerFeedback).questionId === itemId;
      }
      return false;
    });
  }

  // Auto-approve good content for knowledge base
  async autoApproveContent(content: {
    type: 'documentation' | 'answer';
    id: string;
    content: string;
    source: string;
  }): Promise<void> {
    const feedback = this.getFeedbackForItem(content.id, content.type);
    const avgRating = feedback.length > 0 
      ? feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length 
      : 0;

    // Auto-approve content with high ratings and multiple positive feedback
    if (avgRating >= 4 && feedback.length >= 3) {
      let chunks;
      
      if (content.type === 'documentation') {
        chunks = chunkQA(
          `Documentation for ${content.id}`,
          content.content,
          content.source,
          { chunkType: 'document' }
        );
      } else {
        chunks = chunkQA(
          `Answer for ${content.id}`,
          content.content,
          content.source,
          { chunkType: 'qa' }
        );
      }

      chunks.forEach(chunk => {
        chunk.metadata = {
          ...chunk.metadata,
          autoApproved: true,
          averageRating: avgRating,
          feedbackCount: feedback.length,
          approvalDate: new Date().toISOString()
        };
      });

      await embedAndStoreChunks(chunks);
    }
  }
}

// Global feedback loop instance
export const feedbackLoop = new FeedbackLoop();

// Utility functions
export function createFeedback(
  type: UserFeedback['type'],
  rating: number,
  context: UserFeedback['context'],
  additional: Partial<UserFeedback> = {}
): UserFeedback {
  return {
    id: `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    rating,
    helpful: rating >= 3,
    context,
    ...additional
  };
}

export function createDocumentationFeedback(
  documentationId: string,
  rating: number,
  improvements: string[],
  missingInfo: string[],
  context: UserFeedback['context'],
  additional: Partial<DocumentationFeedback> = {}
): DocumentationFeedback {
  return {
    ...createFeedback('documentation', rating, context, additional),
    type: 'documentation',
    documentationId,
    improvements,
    missingInfo
  } as DocumentationFeedback;
}

export function createAnswerFeedback(
  questionId: string,
  rating: number,
  context: UserFeedback['context'],
  correctAnswer?: string,
  sources?: AnswerFeedback['sources'],
  additional: Partial<AnswerFeedback> = {}
): AnswerFeedback {
  return {
    ...createFeedback('answer', rating, context, additional),
    type: 'answer',
    questionId,
    correctAnswer,
    sources
  } as AnswerFeedback;
}