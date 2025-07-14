import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { safeJsonParse } from '@/lib/utils';
import { searchKnowledgeBase } from '@/lib/pinecone';

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
  "integratedRules": ["string"],
  "kpis": [
    {
      "name": "string",
      "definition": "string",
      "calculationLogic": "string",
      "businessPurpose": "string",
      "dataSource": "string",
      "frequency": "string",
      "owner": "string",
      "tags": ["string"]
    }
  ]
}

Additional Guidance:
- Populate "dataSources" with ALL input tables or files referenced in the script.
- "databricksTables" lists every table the script creates or overwrites in Databricks along with a concise business-focused description.
- "tableMetadata" must be an array, one object per output table listed in "databricksTables". Each object has:
    "tableName": the output table name, and
    "columns": an array with one entry per column (fields: columnName, dataType, description, sampleValues, sourceTable, sourceColumn).
  This groups metadata table-wise rather than mixing all columns together.
- "integratedRules" should be a BULLETED LIST (array of strings) in logical order summarising the transformations/business logic. DO NOT return this as a table. Write ALL rules—do not omit any.
- "kpis" should extract ALL Key Performance Indicators, metrics, calculations, and business measures from the code. Look for:
  * Data processing metrics (record counts, processing times, error rates)
  * Business metrics (sales figures, conversion rates, user engagement)
  * API metrics (response times, request counts, success rates)
  * Performance metrics (throughput, latency, resource usage)
  * Quality metrics (accuracy, completeness, data quality scores)
  * Operational metrics (system health, availability, uptime)
  
  For each KPI include:
  * name: The KPI name (e.g., "API Response Time", "Daily Active Users", "Error Rate")
  * definition: Clear business definition of what this KPI measures
  * calculationLogic: Exact formula/logic used in the code (e.g., "COUNT(errors) / COUNT(total_requests) * 100")
  * businessPurpose: Why this KPI is important for business decisions
  * dataSource: Which table/source/system provides the data for this KPI
  * frequency: How often this KPI is calculated (real-time, daily, weekly, monthly, etc.)
  * owner: Business owner or team responsible for this KPI (e.g., "Engineering Team", "Sales Team")
  * tags: Array of relevant tags for categorization (e.g., ["api", "performance", "real-time", "sales"])
  
  IMPORTANT: Even if the code is infrastructure/setup code (like FastAPI apps, Lambda handlers), identify potential KPIs such as:
  - Request processing metrics (requests per second, total daily requests)
  - Error handling metrics (4xx/5xx error rates, exception frequency)  
  - Performance benchmarks (API response time, database query time)
  - User interaction metrics (unique users per day, session duration)
  - System health indicators (uptime percentage, resource utilization)
  - Business metrics (API usage by endpoint, feature adoption rates)
  
  EXAMPLES for FastAPI/Web API applications:
  - "API Request Volume" - Total number of API requests processed
  - "Average Response Time" - Mean time to respond to API requests  
  - "Error Rate" - Percentage of requests that result in 4xx/5xx errors
  - "Healthcare Professional Interactions" - Number of interactions between sales reps and healthcare professionals
  - "Daily Active Users" - Unique users accessing the API per day
  - "Endpoint Usage Distribution" - Usage statistics per API endpoint
- For the "sourceTable" field in "tableMetadata": if the script uses a temporary view or CTE, resolve it to the ORIGINAL underlying table (i.e., the real table or file from which the temp view is created). Do NOT use the temp view name here.
- Do NOT omit any property. Use "N/A" if genuinely unknown – avoid leaving blanks.
- The response MUST be valid JSON – no markdown, no comments, no leading/trailing text.
- WRITE ALL INTEGRATION RULES IN THE "integratedRules" FIELD. WRITE ALL STEPS DONT LEAVE ANYTHING OUT.
- IDENTIFY AND EXTRACT ALL KPIs, METRICS, AND CALCULATIONS FROM THE CODE. Look for aggregations, ratios, percentages, counts, sums, averages, and any business metrics being calculated.
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

    // Search for existing KPI definitions for this filename or similar
    const existingKPIs = await searchKnowledgeBase(
      `KPI definitions ${filename}`,
      {
        filter: { contentType: 'kpi' },
        topK: 10
      }
    );

    // Build user prompt with optional Excel content and existing DOCX sections
    let userContent = `${DOCUMENTATION_TEMPLATE}\n\nPython file: ${filename}\n\nPython Code:\n\u0060\u0060\u0060python\n${pythonCode}\n\u0060\u0060\u0060`;
    if (existingExcel) {
      userContent += `\n\nExisting Excel Data (CSV format of first sheet):\n\u0060\u0060\u0060csv\n${existingExcel}\n\u0060\u0060\u0060`;
    }
    if (existingKPIs.matches && existingKPIs.matches.length > 0) {
      userContent += `\n\nExisting KPI Definitions from Knowledge Base:\n`;
      existingKPIs.matches.forEach((match, index) => {
        userContent += `\nKPI ${index + 1}:\n${match.metadata?.content || 'No content available'}\n`;
      });
      userContent += `\nInstructions: When generating KPIs, reuse existing definitions where applicable and maintain consistency in naming and calculation logic.`;
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
                  content: 'You are a technical documentation expert specializing in Python code documentation for business audiences. You analyze all types of Python code including data pipelines, web APIs, FastAPI applications, Lambda functions, and business applications. Your task is to create comprehensive documentation that identifies and extracts ALL potential KPIs and metrics, even from infrastructure code. For API applications, focus on identifying metrics like request counts, response times, error rates, user interactions, and business outcomes. Always extract meaningful KPIs that business stakeholders would find valuable for monitoring, decision-making, and performance tracking.',
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