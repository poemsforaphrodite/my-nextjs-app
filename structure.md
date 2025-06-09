# Project Structure Documentation

## Overview
This is a Next.js application that generates comprehensive documentation for Python files using OpenAI's O3-mini model. The app provides a user-friendly interface for file upload and displays structured documentation output.

## Directory Structure

```
my-nextjs-app/
├── src/
│   └── app/
│       ├── api/
│       │   └── generate-docs/
│       │       └── route.ts          # API endpoint for documentation generation
│       │       └── route.ts          # API endpoint for documentation generation
│       ├── page.tsx                  # Main application interface
│       ├── layout.tsx                # Root layout component
│       ├── globals.css               # Global styles
│       └── favicon.ico               # App icon
├── public/                           # Static assets
├── package.json                      # Dependencies and scripts
├── tsconfig.json                     # TypeScript configuration
├── next.config.ts                    # Next.js configuration
├── postcss.config.mjs                # PostCSS configuration
├── eslint.config.mjs                 # ESLint configuration
└── README.md                         # Project documentation
```

## File Functions

### Core Application Files

#### `src/app/page.tsx`
- **Purpose**: Main application interface and user interaction logic
- **Functions**:
  - File upload handling with drag & drop support
  - Python file validation (.py extension)
  - API communication for documentation generation
  - Documentation display and download functionality
  - Error handling and loading states
- **Components**: 
  - File dropzone using react-dropzone
  - Upload progress indicators
  - Documentation output display
  - Download button for generated docs

#### `src/app/api/generate-docs/route.ts`
- **Purpose**: Backend API endpoint for OpenAI integration
- **Functions**:
  - Receives Python code and filename from frontend
  - Integrates with OpenAI O3-mini model
  - Applies structured documentation template
  - Returns formatted documentation
  - Error handling for API failures
- **Key Features**:
  - OpenAI API key validation
  - Structured prompt engineering for consistent output
  - Model parameter optimization (temperature: 0.3, max_tokens: 4000)

#### `src/app/layout.tsx`
- **Purpose**: Root layout component for the application
- **Functions**:
  - Defines HTML structure and metadata
  - Applies global styling (Tailwind CSS)
  - Sets up font optimization
  - Configures viewport and responsive design

#### `src/app/globals.css`
- **Purpose**: Global CSS styles and Tailwind CSS imports
- **Functions**:
  - Imports Tailwind CSS directives
  - Defines custom CSS variables
  - Sets global styling rules

### Configuration Files

#### `package.json`
- **Purpose**: Project dependencies and scripts
- **Key Dependencies**:
  - `openai`: OpenAI API integration
  - `react-dropzone`: File upload functionality
  - `lucide-react`: Icon components
  - `next`, `react`, `react-dom`: Core framework
  - `tailwindcss`: Styling framework

#### `tsconfig.json`
- **Purpose**: TypeScript configuration
- **Functions**:
  - Enables strict type checking
  - Configures module resolution
  - Sets up path aliases for imports

#### `next.config.ts`
- **Purpose**: Next.js framework configuration
- **Functions**:
  - Configures build optimization
  - Sets up API routes
  - Enables TypeScript support

## Data Flow

1. **File Upload**: User uploads Python file via drag & drop interface
2. **Validation**: Frontend validates file type and size
3. **API Request**: File content sent to `/api/generate-docs` endpoint
4. **AI Processing**: OpenAI O3-mini analyzes code using structured prompt
5. **Documentation Generation**: AI returns formatted documentation
6. **Display**: Frontend renders documentation with download option

## Key Business Logic

### Documentation Template Structure
The application enforces a specific documentation format:
- Dataset metadata (name, owner, refresh frequency)
- Summary section (description, table grain, input/output datasets)
- Process flow and steps
- KPIs and business definitions

### Error Handling
- File type validation
- API key configuration checks
- OpenAI API error management
- Network failure recovery

### User Experience
- Drag & drop file upload
- Real-time processing feedback
- Downloadable documentation output
- Responsive design for all devices

## Environment Requirements

### Required Environment Variables
- `OPENAI_API_KEY`: OpenAI API key with O3-mini model access

### Development Commands
- `npm run dev`: Start development server
- `npm run build`: Build production application
- `npm run start`: Start production server
- `npm run lint`: Run ESLint checks

## API Endpoints

### POST `/api/generate-docs`
- **Input**: `{ pythonCode: string, filename: string }`
- **Output**: `{ documentation: string }` or `{ error: string }`
- **Purpose**: Generate documentation from Python code using OpenAI O3-mini 