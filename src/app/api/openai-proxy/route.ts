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

interface KPISearchResult {
  searchedKPI: string;
  match: {
    id: string;
    score?: number;
    metadata?: {
      content?: string;
      [key: string]: unknown;
    };
  };
  score: number;
}

interface KPIObject {
  name: string;
  definition?: string;
  calculationLogic?: string;
  businessPurpose?: string;
  dataSource?: string;
  frequency?: string;
  owner?: string;
  tags?: string[];
  [key: string]: unknown;
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

// Function to extract KPI names from Python code
async function extractKPINames(pythonCode: string): Promise<string[]> {
  const extractionPrompt = `You are a KPI extraction expert. Analyze the provided Python code and identify ALL potential KPI names, metrics, and business measures.

Python Code Analysis:
\`\`\`python
${pythonCode}
\`\`\`

Look for these types of business metrics in the code:
- Revenue calculations (gross_rev, net_rev, total_revenue)
- Count operations (COUNT, SUM, total_*) 
- Error tracking (error_rate, failure_count)
- Performance metrics (response_time, throughput)
- User/patient metrics (patient_count, engagement)
- Conversion calculations (conversion_rate, success_rate)
- Shipment/delivery metrics (shipments, deliveries)
- Financial metrics (profit, cost, margin)

Extract business-friendly KPI names from variables, functions, and calculations.

You MUST return a JSON object with a "kpis" array. If no KPIs are found, return an empty array:
{
  "kpis": ["Total Revenue", "Error Rate", "Patient Engagement Count"]
}

OR if no KPIs found:
{
  "kpis": []
}

Return only the JSON object, no additional text.`;

  try {
    console.log('[KPI Extraction] Using model:', process.env.OPENAI_MODEL || 'gpt-4o-mini');
    console.log('[KPI Extraction] Python code length:', pythonCode.length);
    console.log('[KPI Extraction] Python code preview:', pythonCode.substring(0, 500) + '...');
    
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a KPI extraction expert. Analyze code and extract business metrics and KPIs.'
        },
        {
          role: 'user',
          content: extractionPrompt
        }
      ],
      max_completion_tokens: 1000
    });

    const responseContent = response.choices[0].message.content || '[]';
    console.log('[KPI Extraction] Model used:', response.model);
    console.log('[KPI Extraction] Raw response:', responseContent);
    console.log('[KPI Extraction] Response length:', responseContent.length);
    
    // Try to parse as JSON first
    let result;
    try {
      result = JSON.parse(responseContent);
      console.log('[KPI Extraction] Parsed as JSON:', result);
    } catch {
      console.log('[KPI Extraction] Not valid JSON, treating as text response');
      
      // Extract KPIs from text response
      const kpiMatches = responseContent.match(/["']([^"']*(?:revenue|rate|count|total|error|conversion|shipment|patient|engagement|demand|profit|cost|margin|success|failure|throughput|latency|dispense|finance|analytics)[^"']*)["']/gi);
      if (kpiMatches) {
        const extractedKPIs = kpiMatches.map(match => match.replace(/["']/g, ''));
        console.log('[KPI Extraction] Extracted KPIs from text:', extractedKPIs);
        return extractedKPIs;
      }
      
      // Try to extract lines that look like KPI names
      const lines = responseContent.split('\n');
      const kpiLines = lines.filter(line => 
        line.toLowerCase().includes('revenue') || 
        line.toLowerCase().includes('rate') ||
        line.toLowerCase().includes('count') ||
        line.toLowerCase().includes('total') ||
        line.toLowerCase().includes('error') ||
        line.toLowerCase().includes('shipment') ||
        line.toLowerCase().includes('patient') ||
        line.toLowerCase().includes('engagement')
      );
      
      if (kpiLines.length > 0) {
        console.log('[KPI Extraction] Found KPI lines:', kpiLines);
        return kpiLines.map(line => line.trim().replace(/^[-*•]\s*/, ''));
      }
      
      // Final fallback
      console.log('[KPI Extraction] No KPIs found in text, using fallback pattern matching...');
      const fallbackKPIs = extractKPIsFromCodePatterns(pythonCode);
      if (fallbackKPIs.length > 0) {
        console.log('[KPI Extraction] Text fallback found KPIs:', fallbackKPIs);
        return fallbackKPIs;
      }
      
      return [];
    }
    
    // Handle both array format and object format responses
    if (Array.isArray(result)) {
      console.log('[KPI Extraction] Found array format, returning:', result);
      
      // If the array is empty, try fallback pattern matching
      if (result.length === 0) {
        console.log('[KPI Extraction] OpenAI returned empty array, trying fallback pattern matching...');
        const fallbackKPIs = extractKPIsFromCodePatterns(pythonCode);
        if (fallbackKPIs.length > 0) {
          console.log('[KPI Extraction] Fallback found KPIs:', fallbackKPIs);
          return fallbackKPIs;
        }
      }
      
      return result;
    } else if (result && typeof result === 'object' && result.kpis && Array.isArray(result.kpis)) {
      console.log('[KPI Extraction] Found object format with kpis array:', result.kpis);
      
      // If the kpis array is empty, try fallback pattern matching
      if (result.kpis.length === 0) {
        console.log('[KPI Extraction] OpenAI returned empty kpis array, trying fallback pattern matching...');
        const fallbackKPIs = extractKPIsFromCodePatterns(pythonCode);
        if (fallbackKPIs.length > 0) {
          console.log('[KPI Extraction] Fallback found KPIs:', fallbackKPIs);
          return fallbackKPIs;
        }
      }
      
      return result.kpis;
    } else if (result && typeof result === 'object' && Object.keys(result).length === 0) {
      console.log('[KPI Extraction] Found empty object, trying fallback pattern matching...');
      const fallbackKPIs = extractKPIsFromCodePatterns(pythonCode);
      if (fallbackKPIs.length > 0) {
        console.log('[KPI Extraction] Fallback found KPIs:', fallbackKPIs);
        return fallbackKPIs;
      }
      return [];
    } else {
      console.warn('[KPI Extraction] Unexpected response format:', result);
      console.warn('[KPI Extraction] Result type:', typeof result);
      console.warn('[KPI Extraction] Result keys:', result && typeof result === 'object' ? Object.keys(result) : 'N/A');
      
      // Try to extract KPIs from the raw response if it's a string
      if (typeof result === 'string') {
        console.log('[KPI Extraction] Attempting to extract KPIs from string response');
        const kpiMatches = result.match(/["']([^"']*(?:revenue|rate|count|total|error|conversion|shipment|patient|engagement)[^"']*)["']/gi);
        if (kpiMatches) {
          const extractedKPIs = kpiMatches.map(match => match.replace(/["']/g, ''));
          console.log('[KPI Extraction] Extracted KPIs from string:', extractedKPIs);
          return extractedKPIs;
        }
      }
      
      // Final fallback
      console.log('[KPI Extraction] Trying final fallback pattern matching...');
      const fallbackKPIs = extractKPIsFromCodePatterns(pythonCode);
      if (fallbackKPIs.length > 0) {
        console.log('[KPI Extraction] Final fallback found KPIs:', fallbackKPIs);
        return fallbackKPIs;
      }
      
      return [];
    }
  } catch (error) {
    console.error('Error extracting KPI names:', error);
    
    // Fallback: Simple pattern matching for common KPIs
    console.log('[KPI Extraction] Attempting fallback pattern matching...');
    const fallbackKPIs = extractKPIsFromCodePatterns(pythonCode);
    if (fallbackKPIs.length > 0) {
      console.log('[KPI Extraction] Fallback found KPIs:', fallbackKPIs);
      return fallbackKPIs;
    }
    
    return [];
  }
}

// Fallback function to extract KPIs using simple pattern matching
function extractKPIsFromCodePatterns(pythonCode: string): string[] {
  const kpis: string[] = [];
  const codeLines = pythonCode.toLowerCase();
  
  // Common patterns to look for
  const patterns = [
    { pattern: /revenue|gross_rev|net_rev/, kpi: 'Total Revenue' },
    { pattern: /error|failure|exception/, kpi: 'Error Rate' },
    { pattern: /conversion|convert/, kpi: 'Conversion Rate' },
    { pattern: /shipment|ship_|delivery/, kpi: 'Total Shipments' },
    { pattern: /patient|engagement/, kpi: 'Patient Engagement Count' },
    { pattern: /total_demand|demand/, kpi: 'Total Demand' },
    { pattern: /count\(|sum\(|total_/, kpi: 'Total Count' },
    { pattern: /response_time|latency/, kpi: 'Response Time' },
    { pattern: /throughput|requests_per/, kpi: 'Throughput' },
    { pattern: /success_rate|success/, kpi: 'Success Rate' }
  ];
  
  for (const { pattern, kpi } of patterns) {
    if (pattern.test(codeLines) && !kpis.includes(kpi)) {
      kpis.push(kpi);
    }
  }
  
  return kpis;
}

// Function to search for specific KPI definitions in the vector database
async function searchForKPIDefinitions(kpiNames: string[]): Promise<KPISearchResult[]> {
  const kpiDefinitions: KPISearchResult[] = [];
  
  for (const kpiName of kpiNames) {
    try {
      // Search for each KPI name across all files
      const searchResult = await searchKnowledgeBase(
        kpiName,
        {
          filter: { contentType: 'kpi' },
          topK: 3 // Get top 3 matches for each KPI
        }
      );
      
      if (searchResult.matches && searchResult.matches.length > 0) {
        // Find the best match for this KPI
        const bestMatch = searchResult.matches.find(match => {
          const content = String(match.metadata?.content || '');
          const parsedContent = safeJsonParse(content);
          
          if (Array.isArray(parsedContent)) {
            // Handle array of KPIs
            return parsedContent.some((kpi: KPIObject) => 
              kpi.name && kpi.name.toLowerCase().includes(kpiName.toLowerCase())
            );
          } else if (parsedContent && typeof parsedContent === 'object' && 'name' in parsedContent) {
            // Handle single KPI object
            const kpiObj = parsedContent as KPIObject;
            return kpiObj.name.toLowerCase().includes(kpiName.toLowerCase());
          }
          
          return false;
        });
        
        if (bestMatch) {
          kpiDefinitions.push({
            searchedKPI: kpiName,
            match: bestMatch,
            score: bestMatch.score || 0
          });
        }
      }
    } catch (error) {
      console.error(`Error searching for KPI "${kpiName}":`, error);
    }
  }
  
  return kpiDefinitions;
}

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

    // Two-pass KPI approach: First extract KPI names, then search for their definitions
    console.log('[openai-proxy] Step 1: Extracting KPI names from code...');
    const extractedKPINames = await extractKPINames(pythonCode);
    console.log('[openai-proxy] Extracted KPI names:', extractedKPINames);
    
    console.log('[openai-proxy] Step 2: Searching for KPI definitions in vector database...');
    const kpiDefinitions = await searchForKPIDefinitions(extractedKPINames);
    console.log('[openai-proxy] Found KPI definitions:', kpiDefinitions.length);

    // Build user prompt with optional Excel content and existing DOCX sections
    let userContent = `${DOCUMENTATION_TEMPLATE}\n\nPython file: ${filename}\n\nPython Code:\n\u0060\u0060\u0060python\n${pythonCode}\n\u0060\u0060\u0060`;
    if (existingExcel) {
      userContent += `\n\nExisting Excel Data (CSV format of first sheet):\n\u0060\u0060\u0060csv\n${existingExcel}\n\u0060\u0060\u0060`;
    }
    if (kpiDefinitions.length > 0) {
      userContent += `\n\nExisting KPI Definitions from Knowledge Base:\n`;
      kpiDefinitions.forEach((kpiDef, index) => {
        const content = String(kpiDef.match.metadata?.content || '');
        const parsedContent = safeJsonParse(content);
        
        if (Array.isArray(parsedContent)) {
          // Handle array of KPIs - find the matching one
          const matchingKPI = parsedContent.find((kpi: KPIObject) => 
            kpi.name && kpi.name.toLowerCase().includes(kpiDef.searchedKPI.toLowerCase())
          );
          if (matchingKPI) {
            userContent += `\nKPI ${index + 1} - ${kpiDef.searchedKPI}:\n${JSON.stringify(matchingKPI, null, 2)}\n`;
          }
        } else if (parsedContent && typeof parsedContent === 'object' && 'name' in parsedContent) {
          // Handle single KPI object
          userContent += `\nKPI ${index + 1} - ${kpiDef.searchedKPI}:\n${JSON.stringify(parsedContent, null, 2)}\n`;
        } else {
          // Fallback to raw content
          userContent += `\nKPI ${index + 1} - ${kpiDef.searchedKPI}:\n${content}\n`;
        }
      });
      userContent += `\n\nInstructions: When generating KPIs, PRIORITIZE reusing the existing definitions above for matching KPIs. For KPIs that match the existing definitions, use the EXACT same:
- name
- definition 
- calculationLogic
- businessPurpose
- dataSource
- frequency
- owner
- tags

Only create new KPI definitions for metrics not found in the existing definitions.`;
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