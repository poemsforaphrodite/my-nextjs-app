# Python File Documentation Generator

A Next.js application that automatically generates comprehensive documentation for Python files using OpenAI's O3-mini model.

## Features

- **File Upload**: Drag & drop or click to upload Python (.py) files
- **AI-Powered Documentation**: Uses OpenAI O4-mini to analyze code and generate structured documentation
- **Structured Output**: Follows a specific business template for data pipeline documentation
- **DOCX Export**: Automatically downloads professional Word documents with proper formatting
- **Modern UI**: Clean, responsive interface built with Tailwind CSS

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Create a `.env.local` file in the root directory:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

**Important**: You need an OpenAI API key with access to the O3-mini model.

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Documentation Format

The generated documentation follows this structure:

1. **Summary**
   - Description of the Python code's purpose
   - Table grain (data processing level)
   - Input datasets
   - Output datasets

2. **Process Flow & Steps**
   - High-level process overview
   - Detailed step-by-step breakdown with:
     - Step descriptions
     - Input data sources
     - Join conditions/operations
     - Business definitions

3. **KPIs & Business Definitions**
   - Calculated fields and their definitions
   - Flags and their business meaning
   - Metrics and calculation logic

## Usage

1. **Upload File**: Drag and drop a Python file or click to browse
2. **Generate Documentation**: Click "Generate DOCX Documentation" button
3. **Automatic Download**: The system automatically downloads a professionally formatted Word document

## Tech Stack

- **Framework**: Next.js 15.3.3 with App Router
- **Frontend**: React 19, TypeScript
- **Styling**: Tailwind CSS 4
- **File Upload**: react-dropzone
- **Icons**: Lucide React
- **AI**: OpenAI O4-mini model
- **Document Generation**: docx library for Word document creation
- **Deployment**: Vercel-ready

## API Endpoints

- `POST /api/generate-docs`: Accepts Python code and returns generated documentation

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key with O3-mini access | Yes |

## Error Handling

The application includes comprehensive error handling for:
- Invalid file types
- Missing API configuration
- OpenAI API errors
- Network issues

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
