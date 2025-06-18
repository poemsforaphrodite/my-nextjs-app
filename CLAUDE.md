# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 15 application that generates professional documentation for Python files using OpenAI's O3-mini model. The application analyzes Python code and creates structured Word documents with business-focused documentation including table metadata, data sources, and integration rules.

## Key Architecture

### Frontend-Backend Flow
1. **File Upload** (`src/app/page.tsx`): React component with dropzone for Python files and optional Excel files
2. **AI Processing** (`src/app/api/openai-proxy/route.ts`): Streams OpenAI responses using Server-Sent Events
3. **Document Generation** (`src/app/api/generate-docs/route.ts`): Creates DOCX files from parsed documentation
4. **Document Utilities** (`src/lib/docx-util.ts`): Handles Word document formatting and structure

### Data Flow
- Python file uploaded → OpenAI analysis → Structured JSON documentation → DOCX generation → Download
- Supports Excel file upload for additional context in documentation generation
- Uses streaming responses to handle long-running OpenAI operations

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
```

## Environment Configuration

Required environment variables:
- `OPENAI_API_KEY`: OpenAI API key with O3-mini model access
- `OPENAI_MODEL`: (Optional) OpenAI model to use (defaults to gpt-4o-mini, use o3-2025-04-16 for detailed analysis)

## Testing

- **Framework**: Vitest with Node environment
- **Test files**: `/tests/` directory
- **Coverage**: Includes real Python file testing and DOCX generation validation
- **API Testing**: Integration tests for OpenAI proxy endpoint (skipped without valid API key)

## Key Technical Details

### AI Model Configuration
- Uses OpenAI's `o3-2025-04-16` model
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
Requires access to OpenAI's O3-mini model. The system prompts are specifically tuned for business documentation of data pipeline code.

## Type Definitions

Key TypeScript interfaces defined in multiple files for documentation structure:
- `Documentation` interface with fields for description, tableGrain, dataSources, databricksTables, tableMetadata, integratedRules
- Column metadata structure for database schema documentation