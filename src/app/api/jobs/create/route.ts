import { NextRequest, NextResponse } from 'next/server';
import { createJob, updateJob } from '@/lib/job-store';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const maxDuration = 60;

const DOCUMENTATION_TEMPLATE = `
You are provided with a Python script. Your task is to return extremely detailed documentation in a SINGLE JSON object (no additional text). The JSON MUST follow the exact structure below and every field must be present.

Note on "tableGrain": specify WHICH columns guarantee that the final output table will contain exactly ONE row per combination of those columns.

JSON FORMAT (copy exactly – populate all placeholders):
{
  "description": "string",
  "tableGrain": "string",
  "dataSources": ["string"],
  "databricksTables": [
    { "tableName": "string", "description": "string" }
  ],
  "tableMetadata": [
    {
      "tableName": "string",
      "columns": [
        {
          "columnName": "string",
          "dataType": "string",
          "description": "string",
          "sampleValues": "string",
          "sourceTable": "string",
          "sourceColumn": "string"
        }
      ]
    }
  ],
  "integratedRules": ["string"]
}

Additional Guidance:
- Populate "dataSources" with ALL input tables or files referenced in the script.
- "databricksTables" lists every table the script creates or overwrites in Databricks along with a concise business-focused description.
- "tableMetadata" must be an array, one object per output table listed in "databricksTables". Each object has:
    "tableName": the output table name, and
    "columns": an array with one entry per column (fields: columnName, dataType, description, sampleValues, sourceTable, sourceColumn).
  This groups metadata table-wise rather than mixing all columns together.
- "integratedRules" should be a BULLETED LIST (array of strings) in logical order summarising the transformations/business logic. DO NOT return this as a table. Write ALL rules—do not omit any.
- For the "sourceTable" field in "tableMetadata": if the script uses a temporary view or CTE, resolve it to the ORIGINAL underlying table (i.e., the real table or file from which the temp view is created). Do NOT use the temp view name here.
- Do NOT omit any property. Use "N/A" if genuinely unknown – avoid leaving blanks.
- The response MUST be valid JSON – no markdown, no comments, no leading/trailing text.
- WRITE ALL INTEGRATION RULES IN THE "integratedRules" FIELD. WRITE ALL STEPS DONT LEAVE ANYTHING OUT.
`;

export async function POST(request: NextRequest) {
  try {
    const { pythonCode, filename, existingExcel } = await request.json();

    if (!pythonCode) {
      return NextResponse.json({ error: 'pythonCode is required' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Generate unique job ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create job
    createJob(jobId);

    // Start background processing (fire and forget)
    processInBackground(jobId, pythonCode, filename, existingExcel);

    return NextResponse.json({ jobId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('job creation error', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function processInBackground(jobId: string, pythonCode: string, filename: string, existingExcel?: string) {
  try {
    updateJob(jobId, { status: 'processing', progress: 'Starting OpenAI analysis...' });

    // Build user prompt with optional Excel content
    let userContent = `${DOCUMENTATION_TEMPLATE}\n\nPython file: ${filename}\n\nPython Code:\n\`\`\`python\n${pythonCode}\n\`\`\``;
    if (existingExcel) {
      userContent += `\n\nExisting Excel Data (CSV format of first sheet):\n\`\`\`csv\n${existingExcel}\n\`\`\``;
    }
    userContent += `\n\nPlease generate the documentation following the exact template format provided above.`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'o3-2025-04-16',
      response_format: { type: 'json_object' },
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            'You are a technical documentation expert specializing in data pipeline and analytics code documentation for a business audience. Your task is to help business users understand Python code related to sales representative activities with doctors and hospitals. You create comprehensive, structured documentation that follows specific business templates for data processing workflows, ensuring all KPIs are explained in their business context. You must explain technical steps in terms of their business impact and logic.',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    });

    updateJob(jobId, { progress: 'Receiving response from OpenAI...' });

    let docString = '';
    let chunkCount = 0;
    
    interface StreamChunk { choices: { delta?: { content?: string } }[] }
    for await (const chunk of completion as AsyncIterable<StreamChunk>) {
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        docString += delta;
        chunkCount++;
        
        // Update progress every 20 chunks
        if (chunkCount % 20 === 0) {
          updateJob(jobId, { progress: `Processing O3 response... (${chunkCount} chunks received)` });
        }
      }
    }

    updateJob(jobId, { progress: 'Parsing documentation...' });

    // Parse and store result
    const documentation = JSON.parse(docString);
    updateJob(jobId, { 
      status: 'completed', 
      progress: 'Documentation generation completed',
      result: documentation 
    });

  } catch (err: unknown) {
    console.error('Background processing error', err);
    updateJob(jobId, { 
      status: 'failed', 
      progress: 'Failed to generate documentation',
      error: err instanceof Error ? err.message : 'unknown error'
    });
  }
}