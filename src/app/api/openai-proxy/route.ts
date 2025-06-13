import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const DOCUMENTATION_TEMPLATE = `
You are provided with a Python script. Your task is to return extremely detailed documentation in a SINGLE JSON object (no additional text). The JSON MUST follow the exact structure below and every field must be present.

Note on "tableGrain": specify WHICH columns guarantee that the final output table will contain exactly ONE row per combination of those columns.

JSON FORMAT (copy exactly – populate all placeholders):
{
  "description": "string",
  "tableGrain": "string",
  "dataSources": ["string"],
  "databricksTables": [
    {
      "tableName": "string",
      "description": "string"
    }
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
`;

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY || !openai) {
    return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
  }

  try {
    const { pythonCode, filename } = await request.json();

    if (!pythonCode) {
      return NextResponse.json({ error: 'Python code is required' }, { status: 400 });
    }

    const messages = [
      {
        role: 'system' as const,
        content: 'You are a technical documentation expert specializing in data pipeline and analytics code documentation for a business audience. Your task is to help business users understand Python code related to sales representative activities with doctors and hospitals. You create comprehensive, structured documentation that follows specific business templates for data processing workflows, ensuring all KPIs are explained in their business context. You must explain technical steps in terms of their business impact and logic.',
      },
      {
        role: 'user' as const,
        content: `${DOCUMENTATION_TEMPLATE}

Python file: ${filename}

Python Code:\n\n${pythonCode}\n\nPlease generate the documentation following the exact template format provided above.`,
      },
    ];

    // Use streaming to avoid 60-second timeout - keep connection alive
    const completion = await openai.chat.completions.create({
      model: 'o3-2025-04-16',
      response_format: { type: 'json_object' },
      stream: true,
      messages,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullContent = '';
          
          for await (const chunk of completion) {
            const delta = chunk.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              fullContent += delta;
              // Send partial content to keep connection alive
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ partial: delta })}\n\n`));
            }
          }
          
          // Send final complete documentation
          try {
            const documentation = JSON.parse(fullContent);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
              complete: true, 
              documentation 
            })}\n\n`));
                     } catch {
             controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
               error: 'Failed to parse documentation JSON' 
             })}\n\n`));
           }
          
          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            error: 'OpenAI request failed' 
          })}\n\n`));
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });

  } catch (error) {
    console.error('Error in OpenAI proxy:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
} 