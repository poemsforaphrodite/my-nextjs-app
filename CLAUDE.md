# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 15 application that generates professional documentation for Python files using OpenAI's O3-mini model. The application analyzes Python code and creates structured Word documents with business-focused documentation including table metadata, data sources, and integration rules.

## Key Architecture

### Agentic RAG System
The application uses a multi-agent architecture with RAG (Retrieval-Augmented Generation) for enhanced documentation quality:

1. **Orchestrator Agent** (`src/lib/agents/orchestrator.ts`): Coordinates multi-agent workflows
2. **Writer Agent** (`src/lib/agents/writer.ts`): Generates documentation with RAG context
3. **Critic Agent** (`src/lib/agents/critic.ts`): Reviews and provides feedback for iterative improvement
4. **Router Agent** (`src/lib/agents/router.ts`): Classifies queries and routes to appropriate agents
5. **Answer Agent** (`src/lib/agents/answer.ts`): Handles Q&A with knowledge base retrieval

### Frontend-Backend Flow
1. **File Upload** (`src/app/page.tsx`): React component with dropzone for Python files and optional Excel files
2. **Agent Orchestration** (`src/app/api/agents/orchestrate/route.ts`): Multi-agent workflow coordination
3. **Chat Interface** (`src/app/api/agents/chat/route.ts`): Interactive Q&A with knowledge base
4. **Knowledge Base** (`src/app/api/knowledge-base/`): Document ingestion and semantic search
5. **Document Generation** (`src/app/api/generate-docs/route.ts`): Creates DOCX files from structured documentation
6. **Document Utilities** (`src/lib/docx-util.ts`): Handles Word document formatting and structure

### Data Flow
- **Documentation Generation**: Python file → Orchestrator → Writer Agent (with RAG) → Critic Agent → Refined Documentation → DOCX
- **Q&A Flow**: User question → Router Agent → Answer Agent (with RAG) → Response with sources
- **Knowledge Base**: Documents → Chunking → Embedding → Vector Storage → Retrieval for RAG

### Vector Database Integration
- **Pinecone**: Vector storage for documents, code, and Q&A pairs
- **OpenAI Embeddings**: text-embedding-3-small for vector generation
- **Chunking Strategy**: Intelligent chunking preserving code structure and document sections
- **Retrieval**: Hybrid search across multiple content types with relevance scoring

## Development Commands

```bash
# Development server
npm run dev

# Build application
npm run build

# Production server
npm start

# Linting
npm run lint

# Run tests
npm run test

# Run end-to-end tests
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Run all tests (unit + E2E)
npm run test:all

# Manual API testing
npm run test:api-manual
```

## Environment Configuration

Required environment variables:
- `OPENAI_API_KEY`: OpenAI API key with O3-mini model access
- `OPENAI_MODEL`: (Optional) OpenAI model to use (defaults to gpt-4o-mini, use o3-2025-04-16 for detailed analysis)
- `PINECONE_API_KEY`: Pinecone API key for vector database operations

## Testing

- **Unit Tests**: Vitest with Node environment
- **E2E Tests**: Playwright with Chromium browser
- **Test files**: `/tests/` directory
- **Coverage**: Includes real Python file testing and DOCX generation validation
- **API Testing**: Integration tests for OpenAI proxy endpoint (skipped without valid API key)
- **Manual API Testing**: Dedicated script for manual API endpoint verification

## Key Technical Details

### AI Model Configuration
- Primary model: OpenAI's `o3-2025-04-16` for detailed analysis
- Fallback model: `gpt-4o-mini` for faster responses (default)
- Configured for JSON response format with specific documentation template
- Streaming responses to handle serverless function timeouts

### Documentation Structure
Generated documentation follows a specific business template:
1. Description
2. Table Grain (unique column combinations)
3. Data Sources
4. Databricks Tables (Output)
5. Table Metadata (grouped by table)
6. Integrated Rules

### UI Components
- Built with shadcn/ui components
- Tailwind CSS for styling
- Lucide React icons
- File upload with react-dropzone

## Common Issues

### Vercel Runtime Timeout
The application handles Vercel's serverless function timeout using:
- `maxDuration = 60` export in API routes
- `vercel.json` configuration for function timeouts
- Server-Sent Events streaming with progress updates
- Fallback to faster models (gpt-4o-mini) when needed
- Set `OPENAI_MODEL=o3-2025-04-16` for detailed analysis or `gpt-4o-mini` for faster responses

### OpenAI Model Access
Requires access to OpenAI's o3-2025-04-16 model for detailed analysis. The system prompts are specifically tuned for business documentation of data pipeline code.

## Type Definitions

Key TypeScript interfaces defined in multiple files for documentation structure:
- `Documentation` interface with fields for description, tableGrain, dataSources, databricksTables, tableMetadata, integratedRules
- Column metadata structure for database schema documentation