'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Brain, Search, FileText } from 'lucide-react';

interface Message {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    classification?: {
      intent: string;
      confidence: number;
      agent: string;
    };
    sources?: Array<{
      type: string;
      content: string;
      source: string;
      score: number;
    }>;
  };
}

interface ChatInterfaceProps {
  onMessage?: (message: string) => void;
  className?: string;
  context?: {
    hasDocumentation?: boolean;
    filename?: string;
    documentation?: Record<string, unknown>;
  };
}

export default function ChatInterface({ onMessage, className = '', context }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'system',
      content: 'Hello! I can help you with questions about your documentation, generate new documentation from code, or manage your knowledge base. What would you like to do?',
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          query: input,
          context: {
            sessionId: 'demo-session',
            conversationHistory: messages.slice(-5), // Last 5 messages for context
            hasDocumentation: context?.hasDocumentation,
            filename: context?.filename,
            documentation: context?.documentation
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: '',
        timestamp: Date.now()
      };

      setMessages(prev => [...prev, assistantMessage]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'token') {
                assistantMessage.content += parsed.token;
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantMessage.id ? { ...assistantMessage } : msg
                ));
              } else if (parsed.type === 'classification') {
                assistantMessage.metadata = {
                  classification: {
                    intent: parsed.intent,
                    confidence: parsed.confidence,
                    agent: parsed.agent
                  }
                };
              } else if (parsed.type === 'answer_metadata') {
                assistantMessage.metadata = {
                  ...assistantMessage.metadata,
                  sources: parsed.sources
                };
              } else if (parsed.type === 'clarification') {
                assistantMessage.content = parsed.message;
                if (parsed.alternatives) {
                  assistantMessage.content += '\n\n' + parsed.alternatives.join('\n');
                }
              } else if (parsed.type === 'redirect') {
                assistantMessage.content = parsed.message + '\n\n' + parsed.suggestion;
              } else if (parsed.type === 'documentation_updated') {
                assistantMessage.content += '\n\n📄 Documentation has been updated based on your feedback!';
                // Optionally trigger a callback to update the main page
                if (onMessage) {
                  onMessage('DOCUMENTATION_UPDATED');
                }
              } else if (parsed.type === 'requires_upload') {
                assistantMessage.content += '\n\n📁 ' + parsed.message;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessage.id ? { ...assistantMessage } : msg
      ));

    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        type: 'system',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }

    if (onMessage) {
      onMessage(input);
    }
  };

  const getMessageIcon = (message: Message) => {
    switch (message.type) {
      case 'user':
        return <User className="w-5 h-5" />;
      case 'assistant':
        return <Bot className="w-5 h-5" />;
      case 'system':
        return <Brain className="w-5 h-5" />;
      default:
        return <Bot className="w-5 h-5" />;
    }
  };

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'answer':
        return <Search className="w-4 h-4" />;
      case 'orchestrator':
        return <FileText className="w-4 h-4" />;
      default:
        return <Bot className="w-4 h-4" />;
    }
  };

  return (
    <div className={`flex flex-col h-full bg-white border border-gray-200 rounded-lg ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="w-5 h-5" />
          AI Assistant
        </h3>
        <p className="text-sm text-gray-600">Ask questions or generate documentation</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${
              message.type === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            {message.type !== 'user' && (
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                {getMessageIcon(message)}
              </div>
            )}
            
            <div className={`max-w-[70%] ${
              message.type === 'user' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 text-gray-900'
            } rounded-lg p-3`}>
              <div className="whitespace-pre-wrap">{message.content}</div>
              
              {/* Metadata */}
              {message.metadata && (
                <div className="mt-2 space-y-2">
                  {message.metadata.classification && (
                    <div className="flex items-center gap-2 text-xs opacity-75">
                      {getAgentIcon(message.metadata.classification.agent)}
                      <span>
                        {message.metadata.classification.intent} 
                        ({Math.round(message.metadata.classification.confidence * 100)}% confidence)
                      </span>
                    </div>
                  )}
                  
                  {message.metadata.sources && message.metadata.sources.length > 0 && (
                    <div className="text-xs opacity-75">
                      <div className="font-medium">Sources:</div>
                      {message.metadata.sources.slice(0, 3).map((source, idx) => (
                        <div key={idx} className="flex items-center gap-1 mt-1">
                          <span className="w-2 h-2 bg-current rounded-full"></span>
                          <span>{source.source} ({Math.round(source.score * 100)}%)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              <div className="text-xs opacity-50 mt-2">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            </div>
            
            {message.type === 'user' && (
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                {getMessageIcon(message)}
              </div>
            )}
          </div>
        ))}
        
        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <Bot className="w-5 h-5 animate-pulse" />
            </div>
            <div className="bg-gray-100 rounded-lg p-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question or request documentation..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}