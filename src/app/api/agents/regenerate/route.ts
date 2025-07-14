import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { searchKnowledgeBase } from '@/lib/pinecone';

export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      pythonCode, 
      filename, 
      currentDocumentation, 
      userFeedback,
      chatMode = false
    } = body;

    if (!filename || !currentDocumentation || !userFeedback) {
      return NextResponse.json(
        { error: 'Filename, current documentation, and user feedback are required' },
        { status: 400 }
      );
    }

    // For chat mode, we work with just the existing documentation
    if (chatMode && !pythonCode) {
      return await handleChatModeRegeneration({
        filename,
        currentDocumentation,
        userFeedback,
        request
      });
    }

    if (!pythonCode) {
      return NextResponse.json(
        { error: 'Python code is required for full regeneration' },
        { status: 400 }
      );
    }

    // Search for existing KPI definitions that might be relevant
    const existingKPIs = await searchKnowledgeBase(
      `KPI definitions ${filename}`,
      {
        filter: { contentType: 'kpi' },
        topK: 10
      }
    );

    // Create regeneration prompt
    const regenerationPrompt = `
You are tasked with updating documentation based on user feedback. You must return a SINGLE JSON object following the exact structure below.

ORIGINAL DOCUMENTATION:
${JSON.stringify(currentDocumentation, null, 2)}

USER FEEDBACK:
${userFeedback}

PYTHON CODE:
\`\`\`python
${pythonCode}
\`\`\`

EXISTING KPI DEFINITIONS FROM KNOWLEDGE BASE:
${existingKPIs.matches?.map(match => match.metadata?.content).join('\n\n') || 'No existing KPI definitions found'}

Instructions:
1. Address the user's feedback by modifying the relevant sections
2. Maintain the exact JSON structure from the original documentation
3. For KPIs, use existing definitions from the knowledge base when available
4. If creating new KPIs, follow the established patterns and naming conventions
5. Ensure all fields are populated (use "N/A" if unknown)
6. Return only valid JSON - no markdown, comments, or additional text

JSON FORMAT (update based on feedback):
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
`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a technical documentation expert. Update documentation based on user feedback while maintaining consistency and using existing KPI definitions when available.'
        },
        {
          role: 'user',
          content: regenerationPrompt
        }
      ]
    });

    const updatedDocumentation = JSON.parse(completion.choices[0].message.content || '{}');

    // Get the base URL for internal API calls
    const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    // Store updated KPIs in knowledge base for future reference
    if (updatedDocumentation.kpis && updatedDocumentation.kpis.length > 0) {
      await fetch(`${baseUrl}/api/knowledge-base/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: JSON.stringify(updatedDocumentation.kpis),
          filename: `${filename.replace('.py', '')}_kpis.json`,
          contentType: 'kpi',
          metadata: { 
            generatedFrom: filename, 
            timestamp: new Date().toISOString(),
            userFeedback: userFeedback
          }
        })
      });
    }

    // Store updated documentation
    await fetch(`${baseUrl}/api/knowledge-base/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: JSON.stringify(updatedDocumentation),
        filename: `${filename.replace('.py', '')}_documentation_updated.json`,
        contentType: 'documentation',
        metadata: { 
          generatedFrom: filename, 
          timestamp: new Date().toISOString(),
          updatedBy: 'user_feedback',
          originalFeedback: userFeedback
        }
      })
    });

    return NextResponse.json(updatedDocumentation);

  } catch (error) {
    console.error('Regeneration error:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate documentation' },
      { status: 500 }
    );
  }
}

// Handle chat mode regeneration (without Python code)
async function handleChatModeRegeneration({
  filename,
  currentDocumentation,
  userFeedback,
  request
}: {
  filename: string;
  currentDocumentation: Record<string, unknown>;
  userFeedback: string;
  request: NextRequest;
}) {
  try {
    // Search for existing KPI definitions
    const existingKPIs = await searchKnowledgeBase(
      `KPI definitions ${filename}`,
      {
        filter: { contentType: 'kpi' },
        topK: 10
      }
    );

    // Create a simplified regeneration prompt focused on documentation improvement
    const improvementPrompt = `
You are tasked with improving existing documentation based on user feedback. You must return a SINGLE JSON object following the exact structure of the current documentation.

CURRENT DOCUMENTATION:
${JSON.stringify(currentDocumentation, null, 2)}

USER FEEDBACK:
${userFeedback}

EXISTING KPI DEFINITIONS FROM KNOWLEDGE BASE:
${existingKPIs.matches?.map(match => match.metadata?.content).join('\n\n') || 'No existing KPI definitions found'}

Instructions:
1. Apply the user's feedback to improve the relevant sections
2. For KPIs, use existing definitions from the knowledge base when available
3. Maintain the exact JSON structure from the current documentation
4. Focus on enhancing definitions, calculations, and business purposes
5. If the feedback mentions specific improvements (like "uptime percentage"), enhance those areas
6. Return only valid JSON - no markdown, comments, or additional text

Ensure all fields are populated and the structure matches exactly:
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
`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a documentation improvement expert. Update documentation based on user feedback while maintaining structure and using existing KPI definitions when available.'
        },
        {
          role: 'user',
          content: improvementPrompt
        }
      ]
    });

    const updatedDocumentation = JSON.parse(completion.choices[0].message.content || '{}');

    // Get the base URL for internal API calls
    const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    // Store updated KPIs if they exist
    if (updatedDocumentation.kpis && updatedDocumentation.kpis.length > 0) {
      await fetch(`${baseUrl}/api/knowledge-base/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: JSON.stringify(updatedDocumentation.kpis),
          filename: `${filename.replace('.py', '')}_kpis_updated.json`,
          contentType: 'kpi',
          metadata: { 
            generatedFrom: filename, 
            timestamp: new Date().toISOString(),
            userFeedback: userFeedback,
            chatMode: true
          }
        })
      });
    }

    return NextResponse.json(updatedDocumentation);

  } catch (error) {
    console.error('Chat mode regeneration error:', error);
    return NextResponse.json(
      { error: 'Failed to improve documentation in chat mode' },
      { status: 500 }
    );
  }
}