import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

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
        currentDocumentation,
        userFeedback
      });
    }

    if (!pythonCode) {
      return NextResponse.json(
        { error: 'Python code is required for full regeneration' },
        { status: 400 }
      );
    }

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

Instructions:
1. Address the user's feedback by modifying the relevant sections
2. Maintain the exact JSON structure from the original documentation
3. If creating new KPIs, follow the established patterns and naming conventions
4. Ensure all fields are populated (use "N/A" if unknown)
5. Return only valid JSON - no markdown, comments, or additional text
6. IMPORTANT: Apply the user's feedback exactly as provided - if they specify a formula change, update the calculationLogic field accordingly

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
      model: process.env.OPENAI_MODEL || 'o4-mini-2025-04-16',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a technical documentation expert. Update documentation based on user feedback while maintaining consistency and using existing KPI definitions when available. Pay special attention to formula changes in calculationLogic fields for KPIs.'
        },
        {
          role: 'user',
          content: regenerationPrompt
        }
      ]
    });

    const updatedDocumentation = JSON.parse(completion.choices[0].message.content || '{}');

    // Note: Automatic KPI storage has been disabled. 
    // KPIs are only stored when user explicitly clicks "Store KPIs" button.

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
  currentDocumentation,
  userFeedback
}: {
  currentDocumentation: Record<string, unknown>;
  userFeedback: string;
}) {
  try {
    // Create a simplified regeneration prompt focused on documentation improvement
    const improvementPrompt = `
You are tasked with improving existing documentation based on user feedback. You must return a SINGLE JSON object following the exact structure of the current documentation.

CURRENT DOCUMENTATION:
${JSON.stringify(currentDocumentation, null, 2)}

USER FEEDBACK:
${userFeedback}

Instructions:
1. Apply the user's feedback to improve the relevant sections
2. Maintain the exact JSON structure from the current documentation
3. Focus on enhancing definitions, calculations, and business purposes
4. If the feedback mentions specific improvements, enhance those areas
5. Return only valid JSON - no markdown, comments, or additional text
6. IMPORTANT: Apply the user's feedback exactly as provided - if they specify a formula change, update the calculationLogic field accordingly

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
          content: 'You are a documentation improvement expert. Update documentation based on user feedback while maintaining structure and using existing KPI definitions when available. Pay special attention to formula changes in calculationLogic fields for KPIs.'
        },
        {
          role: 'user',
          content: improvementPrompt
        }
      ]
    });

    const updatedDocumentation = JSON.parse(completion.choices[0].message.content || '{}');

    // Note: Automatic KPI storage has been disabled. 
    // KPIs are only stored when user explicitly clicks "Store KPIs" button.

    return NextResponse.json(updatedDocumentation);

  } catch (error) {
    console.error('Chat mode regeneration error:', error);
    return NextResponse.json(
      { error: 'Failed to improve documentation in chat mode' },
      { status: 500 }
    );
  }
}