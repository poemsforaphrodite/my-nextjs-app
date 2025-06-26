import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { safeJsonParse } from '@/lib/utils';

// Initialize client once (Edge runtime not supported -> Node)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const encoder = new TextEncoder();

// Helper function to send SSE events with proper formatting
type SSEPayload = Record<string, unknown>; // or a stricter union of expected keys
function sendSSE(controller: ReadableStreamDefaultController<Uint8Array>, obj: SSEPayload) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
}

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

export const maxDuration = 300; // Increase max duration to 5 minutes for large files

export async function POST(request: NextRequest) {
  try {
    const { pythonCode, filename, existingExcel, existingDocxSections } = await request.json();

    if (!pythonCode) {
      return NextResponse.json({ error: 'pythonCode is required' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Build user prompt with optional Excel content and existing DOCX sections
    let userContent = `${DOCUMENTATION_TEMPLATE}\n\nPython file: ${filename}\n\nPython Code:\n\u0060\u0060\u0060python\n${pythonCode}\n\u0060\u0060\u0060`;
    if (existingExcel) {
      userContent += `\n\nExisting Excel Data (CSV format of first sheet):\n\u0060\u0060\u0060csv\n${existingExcel}\n\u0060\u0060\u0060`;
    }
    if (existingDocxSections) {
      userContent += `\n\nExisting Word Document Sections:\n`;
      for (const [sectionName, content] of Object.entries(existingDocxSections.sections)) {
        const contentStr = String(content || '');
        if (contentStr && contentStr.trim()) {
          userContent += `\n${sectionName}:\n${contentStr}\n`;
        }
      }
      
      // Add update mode instructions
      userContent += `\n\nCurrent Word document sections (JSON): ${JSON.stringify(existingDocxSections.sections)}\nInstructions: For each section, decide if content must change. Return\n{\n  "updatedSections": { "Description": "string", ... },\n  "unchangedSections": ["SectionName", ...]\n}`;
      
      userContent += `\n\nPlease update and enhance the existing sections with information from the Python code. Preserve good content where appropriate and integrate new findings.`;
    } else {
      userContent += `\n\nPlease generate the documentation following the exact template format provided above.`;
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Immediately start sending data to prevent Vercel timeout
        sendSSE(controller, { progress: 'Job accepted, initializing...' });
        
        // Start a keepalive timer to send regular heartbeats
        const keepAliveInterval = setInterval(() => {
          sendSSE(controller, { heartbeat: Date.now() });
        }, 30000); // Send heartbeat every 30 seconds

        // Run the OpenAI work asynchronously
        (async () => {
          let docString = '';
          let chunkCount = 0;
          try {
            sendSSE(controller, { progress: 'Connecting to OpenAI...' });
            
            const completion = await openai.chat.completions.create({
              model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
              response_format: { type: 'json_object' },
              stream: true,
              messages: [
                {
                  role: 'system',
                  content: 'You are a technical documentation expert specializing in data pipeline and analytics code documentation for a business audience. Your task is to help business users understand Python code related to sales representative activities with doctors and hospitals. You create comprehensive, structured documentation that follows specific business templates for data processing workflows, ensuring all KPIs are explained in their business context. You must explain technical steps in terms of their business impact and logic.',
                },
                {
                  role: 'user',
                  content: userContent,
                },
              ],
            });

            sendSSE(controller, { progress: 'Receiving response from OpenAI...' });

            for await (const chunk of completion as AsyncIterable<StreamChunk>) {
              const delta = chunk.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                docString += delta;
                chunkCount++;
                
                // Send very frequent progress updates to maintain connection
                if (chunkCount % 5 === 0) {
                  sendSSE(controller, { progress: `Processing... (${chunkCount} chunks)` });
                }
                
                // Try to parse and send partial results more frequently
                if (chunkCount % 50 === 0) {
                  const partialDoc = safeJsonParse(docString);
                  if (partialDoc !== undefined) {
                    sendSSE(controller, { partial: true, documentation: partialDoc });
                  }
                }
              }
            }

            clearInterval(keepAliveInterval);
            sendSSE(controller, { progress: 'Finalizing documentation...' });
            
            const parsedDoc = safeJsonParse(docString);

            if (parsedDoc === undefined) {
              console.warn('[openai-proxy] JSON parse failed, payload starts with', docString.slice(0, 120));
              sendSSE(controller, { error: 'Failed to parse documentation JSON' });
              controller.close();
              return;
            }

            // Check if this is update mode response with the new structure
            let finalDoc = parsedDoc;
            if (existingDocxSections && parsedDoc && typeof parsedDoc === 'object' && 
                'updatedSections' in parsedDoc && 'unchangedSections' in parsedDoc) {
              // Handle update mode structure: { updatedSections, unchangedSections }
              const { updatedSections, unchangedSections } = parsedDoc as {
                updatedSections: Record<string, string>;
                unchangedSections: string[];
              };
              
              // Merge updated sections with unchanged sections from existing document
              finalDoc = { ...updatedSections };
              unchangedSections.forEach(sectionName => {
                if (existingDocxSections.sections[sectionName] && finalDoc) {
                  (finalDoc as Record<string, unknown>)[sectionName] = existingDocxSections.sections[sectionName];
                }
              });
            }

            sendSSE(controller, { complete: true, documentation: finalDoc });
            console.log('[openai-proxy] ✅ Documentation generation completed');
            controller.close();
          } catch (err: unknown) {
            clearInterval(keepAliveInterval);
            console.error('[openai-proxy] error', err);
            const errorMessage = err instanceof Error ? err.message : 'unknown error';
            sendSSE(controller, { error: errorMessage });
            controller.close();
          }
        })();
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