import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { 
  Document, 
  Packer, 
  Paragraph, 
  HeadingLevel, 
  TextRun, 
  Table, 
  TableRow, 
  TableCell, 
  WidthType,
  BorderStyle,
  AlignmentType,
  convertInchesToTwip
} from 'docx';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface Documentation {
  datasetInfo: {
    datasetName: string | null;
    market: string | null;
    primaryOwner: string | null;
    refreshFrequency: string | null;
    schemaTableName: string | null;
  };
  summary: {
    description: string;
    tableGrain: string;
    inputDatasets: string[];
    outputDatasets: {
      tableName: string;
      description:string;
    }[];
  };
  processFlow: {
    highLevelProcessFlow: string[];
    stepsPerformed: {
      step: number;
      description: string;
      inputTablesData: string;
      joinConditionsOperations: string;
      businessDefinition: string;
    }[];
  };
  kpisAndBusinessDefinitions: {
    kpis: {
      kpiField: string;
      businessDefinition: string;
    }[];
  };
}

const DOCUMENTATION_TEMPLATE = `
Please analyze the following Python code and generate comprehensive documentation in a structured JSON format.
This template has been updated to test Git deployment with the correct GitHub account.

You must output a single JSON object. Do not include any other text before or after the JSON.
The JSON object should follow this exact structure:

{
  "datasetInfo": {
    "datasetName": "string | null",
    "market": "string | null",
    "primaryOwner": "string | null",
    "refreshFrequency": "string | null",
    "schemaTableName": "string | null"
  },
  "summary": {
    "description": "string",
    "tableGrain": "string",
    "inputDatasets": ["string"],
    "outputDatasets": [
      {
        "tableName": "string",
        "description": "string"
      }
    ]
  },
  "processFlow": {
    "highLevelProcessFlow": ["string"],
    "stepsPerformed": [
      {
        "step": "number",
        "description": "string",
        "inputTablesData": "string",
        "joinConditionsOperations": "string",
        "businessDefinition": "string"
      }
    ]
  },
  "kpisAndBusinessDefinitions": {
    "kpis": [
      {
        "kpiField": "string",
        "businessDefinition": "string"
      }
    ]
  }
}

- For "datasetName", "market", "primaryOwner", "refreshFrequency", "schemaTableName", extract them from the code or infer them. If not available, use placeholders like 'N/A' or an inferred value.
- "inputDatasets" should be a list of strings.
- "outputDatasets" should be an array of objects.
- "highLevelProcessFlow" should be an array of strings describing the high-level steps.
- "stepsPerformed" should be an array of objects, with "step" as a number.
- "kpis" should be an array of objects.

Please analyze the code thoroughly and provide specific, accurate information based on the actual code structure and logic, populating the JSON structure.
`;

// Helper functions for creating document elements
function createSectionHeader(text: string): Paragraph {
    return new Paragraph({
        children: [
            new TextRun({
                text,
                bold: true,
                size: 28, // Increased size for better readability
                color: "1B5E20"
            })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 600, after: 300 },
        border: { bottom: { color: "1B5E20", size: 4, space: 1, style: BorderStyle.SINGLE } }
    });
}

function createSubHeader(text: string): Paragraph {
    return new Paragraph({
        children: [
            new TextRun({
                text,
                bold: true,
                size: 24, // Increased size
                color: "2E7D32"
            })
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
    });
}

function createParagraph(text: string): Paragraph {
    if (!text) return new Paragraph("");
    return new Paragraph({
        children: [new TextRun({ text, size: 22, color: "212121" })],
        spacing: { after: 150, before: 50 },
        alignment: AlignmentType.JUSTIFIED
    });
}

function createBullet(text: string): Paragraph {
    return new Paragraph({
        children: [new TextRun({ text, size: 22, color: "424242" })],
        bullet: { level: 0 },
        spacing: { after: 120, before: 60 },
        indent: { left: convertInchesToTwip(0.25) }
    });
}


function createDocxFromDocumentation(documentation: Documentation, filename: string) {
    const children: (Paragraph | Table)[] = [];

    // Document title and header
    children.push(new Paragraph({
        children: [
            new TextRun({ text: `Python Documentation Report`, bold: true, size: 36, color: "2E86AB" })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
    }));
    children.push(new Paragraph({
        children: [
            new TextRun({ text: `Generated for: ${filename}`, size: 24, color: "666666", italics: true })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 }
    }));
    children.push(new Paragraph({
        children: [new TextRun({ text: "", size: 1 })],
        border: { bottom: { color: "2E86AB", space: 1, style: BorderStyle.SINGLE, size: 6 }},
        spacing: { after: 400 }
    }));

    // Dataset Info
    if (documentation.datasetInfo) {
        const { datasetName, market, primaryOwner, refreshFrequency } = documentation.datasetInfo;
        const infoData = [
            ['Dataset Name', datasetName || '-'],
            ['Market', market || '-'],
            ['Primary Owner', primaryOwner || 'ZS'],
            ['Refresh Frequency', refreshFrequency || 'N/A']
        ];
        children.push(createInfoTable(infoData));
    }

    // Summary Section
    if (documentation.summary) {
        children.push(createSectionHeader('1. Summary'));
        const { description, tableGrain, inputDatasets, outputDatasets } = documentation.summary;
        children.push(createSubHeader('1.1 Description'));
        children.push(createParagraph(description));

        children.push(createSubHeader('1.2 Table Grain'));
        children.push(createParagraph(tableGrain));

        children.push(createSubHeader('1.3 Input Datasets'));
        if (inputDatasets && inputDatasets.length > 0) {
            inputDatasets.forEach((ds: string) => children.push(createBullet(ds)));
        } else {
            children.push(createParagraph("No input datasets specified."));
        }
        
        children.push(createSubHeader('1.4 Output Datasets'));
        if (outputDatasets && outputDatasets.length > 0) {
            const outputTableRows = [
                ['Table Name', 'Table Description'],
                ...outputDatasets.map((d) => [d.tableName, d.description])
            ];
            children.push(createStyledTable(outputTableRows));
        } else {
            children.push(createParagraph("No output datasets specified."));
        }
    }

    // Process Flow
    if (documentation.processFlow) {
        children.push(createSectionHeader('2. Process Flow & Steps Performed'));
        const { highLevelProcessFlow, stepsPerformed } = documentation.processFlow;

        children.push(createSubHeader('2.1 High Level Process Flow'));
        if (highLevelProcessFlow && highLevelProcessFlow.length > 0) {
            highLevelProcessFlow.forEach((step: string) => children.push(createBullet(step)));
        } else {
            children.push(createParagraph("No high-level process flow described."));
        }

        children.push(createSubHeader('2.2 Steps performed in the code'));
        if (stepsPerformed && stepsPerformed.length > 0) {
            const stepsTableRows = [
                ['Step', 'Description', 'Input Tables/Data', 'Join Conditions/Operations', 'Business Definition'],
                ...stepsPerformed.map((s) => [s.step.toString(), s.description, s.inputTablesData, s.joinConditionsOperations, s.businessDefinition])
            ];
            children.push(createStyledTable(stepsTableRows));
        } else {
            children.push(createParagraph("No detailed steps provided."));
        }
    }

    // KPIs & Business Definitions
    if (documentation.kpisAndBusinessDefinitions) {
        children.push(createSectionHeader('3. KPIs & Business Definitions'));
        const { kpis } = documentation.kpisAndBusinessDefinitions;
        if (kpis && kpis.length > 0) {
            const kpiTableRows = [
                ['KPI/Field', 'Business Definition'],
                ...kpis.map((k) => [k.kpiField, k.businessDefinition])
            ];
            children.push(createStyledTable(kpiTableRows));
        } else {
            children.push(createParagraph("No KPIs or business definitions provided."));
        }
    }


    return new Document({
        sections: [{
            properties: {
                page: {
                    margin: { top: convertInchesToTwip(1), right: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1) }
                }
            },
            children: children
        }]
    });
}

function createInfoTable(data: string[][]) {
  const headers = data.map(d => d[0]);
  const values = data.map(d => d[1]);
  
  return new Table({
    rows: [
      new TableRow({
        children: headers.map(header => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ 
              text: header, 
              bold: true, 
              color: "000000",
              size: 20
            })],
            alignment: AlignmentType.CENTER
          })],
          margins: { top: 200, bottom: 200, left: 200, right: 200 }
        }))
      }),
      new TableRow({
        children: values.map((cell) => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ 
              text: cell,
              size: 20,
              color: "000000"
            })],
            alignment: AlignmentType.CENTER
          })],
          margins: { top: 200, bottom: 200, left: 200, right: 200 }
        }))
      })
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "2E86AB" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "2E86AB" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "2E86AB" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "2E86AB" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" }
    },
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: 200, bottom: 400 }
  });
}

function createStyledTable(tableRows: string[][]) {
  if (tableRows.length === 0) return new Paragraph({ text: "" });
  
  const [headerRow, ...dataRows] = tableRows;
  
  const docRows = [
    // Header row
    new TableRow({
      children: headerRow.map(cell => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ 
            text: cell.trim(), 
            bold: true, 
            color: "000000",
            size: 20
          })],
          alignment: AlignmentType.CENTER
        })],
        margins: { top: 200, bottom: 200, left: 200, right: 200 },
        width: { size: 100 / headerRow.length, type: WidthType.PERCENTAGE }
      }))
    }),
    // Data rows
    ...dataRows.map((row) => new TableRow({
      children: row.map(cell => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ 
            text: cell.trim(),
            size: 20,
            color: "000000"
          })],
          alignment: AlignmentType.LEFT
        })],
        margins: { top: 150, bottom: 150, left: 200, right: 200 },
        width: { size: 100 / headerRow.length, type: WidthType.PERCENTAGE }
      }))
    }))
  ];

  return new Table({
    rows: docRows,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: "1B5E20" },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "1B5E20" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "1B5E20" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "1B5E20" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "E0E0E0" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "E0E0E0" }
    },
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: 300, bottom: 400 }
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'create-docx') {
      const { documentation, filename } = body;
      if (!documentation || !filename) {
        return NextResponse.json({ error: 'Documentation data and filename are required' }, { status: 400 });
      }
      const doc = createDocxFromDocumentation(documentation, filename);
      const buffer = await Packer.toBuffer(doc);

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${filename.replace('.py', '')}_documentation.docx"`,
        },
      });
    }

    const { pythonCode, filename } = body;

    if (!pythonCode) {
      return NextResponse.json(
        { error: 'Python code is required' },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: 'o4-mini-2025-04-16',
      response_format: { type: "json_object" },
      messages: [
        {
          role: 'system',
          content: `You are a technical documentation expert specializing in data pipeline and analytics code documentation. You create comprehensive, structured documentation that follows specific business templates for data processing workflows.`
        },
        {
          role: 'user',
          content: `${DOCUMENTATION_TEMPLATE}

Python file: ${filename}

Python Code:
\`\`\`python
${pythonCode}
\`\`\`

Please generate the documentation following the exact template format provided above.`
        }
      ],
    });

    const documentationString = completion.choices[0]?.message?.content;

    if (!documentationString) {
      return NextResponse.json(
        { error: 'Failed to generate documentation' },
        { status: 500 }
      );
    }
    
    try {
      const documentationJson = JSON.parse(documentationString);
      return NextResponse.json(documentationJson);
    } catch (error) {
      console.error("Failed to parse JSON from OpenAI:", documentationString);
      return NextResponse.json(
        { error: 'Failed to parse documentation from AI response.' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error generating documentation:', error);
    
    if (error instanceof Error && error.message.includes('model')) {
      return NextResponse.json(
        { error: 'O4-mini model not available. Please check your OpenAI API access.' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to generate documentation' },
      { status: 500 }
    );
  }
} 