import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Initialize client once (Edge runtime not supported -> Node)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const encoder = new TextEncoder();

interface StreamChunk {
  choices: { delta?: { content?: string } }[];
}

// Template copied from server-side file to keep consistent
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

export const maxDuration = 60; // Set max duration to 60 seconds

export async function POST(request: NextRequest) {
  try {
    const { pythonCode, filename, existingExcel } = await request.json();

    if (!pythonCode) {
      return NextResponse.json({ error: 'pythonCode is required' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Build user prompt with optional Excel content
    let userContent = `${DOCUMENTATION_TEMPLATE}\n\nPython file: ${filename}\n\nPython Code:\n\u0060\u0060\u0060python\n${pythonCode}\n\u0060\u0060\u0060`;
    if (existingExcel) {
      userContent += `\n\nExisting Excel Data (CSV format of first sheet):\n\u0060\u0060\u0060csv\n${existingExcel}\n\u0060\u0060\u0060`;
    }
    userContent += `\n\nPlease generate the documentation following the exact template format provided above.`;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let docString = '';
        let chunkCount = 0;
        try {
          // Send initial progress
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 'Starting OpenAI analysis...' })}\n\n`));
          
          // Create a timeout promise for 45 seconds (leave buffer for Vercel)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('OpenAI request timeout after 45 seconds')), 45000);
          });

          const completion = await Promise.race([
            openai.chat.completions.create({
              model: process.env.OPENAI_MODEL || 'o4-mini-2025-04-16',
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
            }),
            timeoutPromise
          ]);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 'Receiving response from OpenAI...' })}\n\n`));

          for await (const chunk of completion as AsyncIterable<StreamChunk>) {
            const delta = chunk.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              docString += delta;
              chunkCount++;
              
              // Send progress updates every 5 chunks for better feedback
              if (chunkCount % 5 === 0) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: `Processing O4 response... (${chunkCount} chunks received)` })}\n\n`));
              }
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: 'Parsing documentation...' })}\n\n`));

          // Send final SSE
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ complete: true, documentation: JSON.parse(docString) })}\n\n`));
          controller.close();
        } catch (err: unknown) {
          console.error('openai-proxy error', err);
          const errorMessage = err instanceof Error ? err.message : 'unknown error';
          
          // If timeout, try fallback with faster model
          if (errorMessage.includes('timeout') && (process.env.OPENAI_MODEL === 'o4-mini-2025-04-16' || !process.env.OPENAI_MODEL)) {
            // Already on mini model, cannot fallback further
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
            controller.close();
            return;
          }
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('openai-proxy catch', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
} 