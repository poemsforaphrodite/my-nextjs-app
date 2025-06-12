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
  ShadingType,
  convertInchesToTwip
} from 'docx';

// Initialize OpenAI client conditionally to handle build-time issues
const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

// -----------------------
// New Documentation types
// -----------------------
export interface Documentation {
  description: string;
  tableGrain: string; // Columns that uniquely define one row in final table
  dataSources: string[]; // List of source datasets / tables used in the script
  databricksTables: {
    tableName: string;
    description: string;
  }[]; // Output tables written in Databricks
  tableMetadata: {
    columnName: string;
    dataType: string;
    description: string;
    sampleValues: string;
    sourceTable: string;
    sourceColumn: string;
  }[]; // Column-level metadata for final table
  integratedRules: string[]; // Bullet list describing the data transformation / business rules applied
}

// -----------------------
// Prompt template
// -----------------------
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
      "columnName": "string",
      "dataType": "string",
      "description": "string",
      "sampleValues": "string",
      "sourceTable": "string",
      "sourceColumn": "string"
    }
  ],
  "integratedRules": ["string"]
}

Additional Guidance:
- Populate "dataSources" with ALL input tables or files referenced in the script.
- "databricksTables" lists every table the script creates or overwrites in Databricks along with a concise business-focused description.
- "tableMetadata" should have one entry PER COLUMN in the final output. Provide meaningful sample values if possible.
- "integratedRules" should be a BULLETED LIST (array of strings) in logical order summarising the transformations/business logic. DO NOT return this as a table. write all don't leave any rules.
- Do NOT omit any property. Use "N/A" if genuinely unknown – avoid leaving blanks.
- The response MUST be valid JSON – no markdown, no comments, no leading/trailing text.
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

function _createSubHeader(text: string): Paragraph {
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
    if (!text || text.trim() === '') return new Paragraph({ text: " " });
    return new Paragraph({
        children: [new TextRun({ text: text.trim(), size: 22, color: "212121" })],
        spacing: { after: 150, before: 50 },
        alignment: AlignmentType.JUSTIFIED
    });
}

function createBullet(text: string): Paragraph {
    return new Paragraph({
        children: [new TextRun({ text: text || '', size: 22, color: "424242" })],
        bullet: { level: 0 },
        spacing: { after: 120, before: 60 },
        indent: { left: convertInchesToTwip(0.25) }
    });
}

function createDocxFromDocumentation(documentation: Documentation, filename: string) {
  const children: (Paragraph | Table)[] = [];

  // Document title and header
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Python Documentation Report`,
          bold: true,
          size: 36,
          color: "2E86AB",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated for: ${filename}`,
          size: 24,
          color: "666666",
          italics: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    })
  );

  children.push(
    new Paragraph({
      children: [new TextRun({ text: "", size: 1 })],
      border: {
        bottom: { color: "2E86AB", space: 1, style: BorderStyle.SINGLE, size: 6 },
      },
      spacing: { after: 400 },
    })
  );

  // 1. Description
  children.push(createSectionHeader("1. Description"));
  children.push(createParagraph(documentation.description));

  // 2. Table Grain
  children.push(createSectionHeader("2. Table Grain"));
  children.push(createParagraph(documentation.tableGrain));

  // 3. Data Sources
  children.push(createSectionHeader("3. Data Sources"));
  if (documentation.dataSources && documentation.dataSources.length > 0) {
    documentation.dataSources.forEach((source: string) => children.push(createBullet(source)));
  } else {
    children.push(createParagraph("No data sources identified."));
  }

  // 4. Databricks Table (Output Tables)
  children.push(createSectionHeader("4. Databricks Tables (Output)"));
  if (documentation.databricksTables && documentation.databricksTables.length > 0) {
    const dbTableRows: string[][] = [
      ["Table Name", "Description"],
      ...documentation.databricksTables.map((tbl) => [tbl.tableName, tbl.description]),
    ];
    children.push(createStyledTable(dbTableRows));
  } else {
    children.push(createParagraph("No Databricks tables specified."));
  }

  // 5. Table Metadata
  children.push(createSectionHeader("5. Table Metadata"));
  if (documentation.tableMetadata && documentation.tableMetadata.length > 0) {
    const metaRows: string[][] = [
      [
        "Column Name",
        "Datatype",
        "Description",
        "Sample Values",
        "Source Table",
        "Source Column",
      ],
      ...documentation.tableMetadata.map((m: Documentation["tableMetadata"][0]) => [
        m.columnName,
        m.dataType,
        m.description,
        m.sampleValues,
        m.sourceTable,
        m.sourceColumn,
      ]),
    ];
    children.push(createStyledTable(metaRows));
  } else {
    children.push(createParagraph("No column metadata provided."));
  }

  // 6. Integrated Rules
  children.push(createSectionHeader("6. Integrated Rules"));
  if (documentation.integratedRules && documentation.integratedRules.length > 0) {
    documentation.integratedRules.forEach((rule: string) => children.push(createBullet(rule)));
  } else {
    children.push(createParagraph("No rules described."));
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children,
      },
    ],
  });
}

function _createInfoTable(data: string[][]) {
  const headers = data.map(d => d[0]);
  const values = data.map(d => d[1]);
  
  return new Table({
    rows: [
      new TableRow({
        children: headers.map(header => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ 
              text: header || '', 
              bold: true, 
              color: "FFFFFF",
              size: 20
            })],
            alignment: AlignmentType.CENTER
          })],
          shading: { fill: "4CAF50", type: ShadingType.SOLID },
          margins: { top: 200, bottom: 200, left: 200, right: 200 }
        }))
      }),
      new TableRow({
        children: values.map((cell) => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ 
              text: cell || '',
              size: 20,
              color: "212121"
            })],
            alignment: AlignmentType.CENTER
          })],
          shading: { fill: "F5F5F5", type: ShadingType.SOLID },
          margins: { top: 200, bottom: 200, left: 200, right: 200 }
        }))
      })
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "4CAF50" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "4CAF50" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "4CAF50" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "4CAF50" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" }
    },
    width: { size: 100, type: WidthType.PERCENTAGE }
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
            text: (cell || '').trim(), 
            bold: true, 
            color: "FFFFFF",
            size: 20
          })],
          alignment: AlignmentType.CENTER
        })],
        shading: { fill: "4CAF50", type: ShadingType.SOLID },
        margins: { top: 200, bottom: 200, left: 200, right: 200 },
        width: { size: 100 / headerRow.length, type: WidthType.PERCENTAGE }
      }))
    }),
    // Data rows
    ...dataRows.map((row, index) => new TableRow({
      children: row.map(cell => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ 
            text: (cell || '').trim(),
            size: 20,
            color: "212121"
          })],
          alignment: AlignmentType.LEFT
        })],
        shading: { 
          fill: index % 2 === 0 ? "F8F9FA" : "FFFFFF", 
          type: ShadingType.SOLID 
        },
        margins: { top: 150, bottom: 150, left: 200, right: 200 },
        width: { size: 100 / headerRow.length, type: WidthType.PERCENTAGE }
      }))
    }))
  ];

  return new Table({
    rows: docRows,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: "4CAF50" },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "4CAF50" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "4CAF50" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "4CAF50" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "E0E0E0" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "E0E0E0" }
    },
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

export async function POST(request: NextRequest) {
  try {
    const { pythonCode, filename, format } = await request.json();

    if (!pythonCode) {
      return NextResponse.json({ error: 'Python code is required' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY || !openai) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // ---------------------------------------------
    // STREAMING PATH (JSON response / default case)
    // ---------------------------------------------
    if (format !== 'docx') {
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const completion = await openai.chat.completions.create({
              model: 'o3-2025-04-16',
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
                  content: `${DOCUMENTATION_TEMPLATE}

Python file: ${filename}

Python Code:
\`\`\`python
${pythonCode}
\`\`\`

Please generate the documentation following the exact template format provided above.`,
                },
              ],
            });

            interface StreamChunk {
              choices: { delta?: { content?: string } }[];
            }

            for await (const chunk of completion as AsyncIterable<StreamChunk>) {
              const delta = chunk.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                controller.enqueue(encoder.encode(delta));
              }
            }

            controller.close();
          } catch (err) {
            console.error('Stream error:', err);
            controller.error(err);
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // ---------------------------------------------
    // DOCX PATH (non-streaming)
    // ---------------------------------------------

    const completion = await openai.chat.completions.create({
      model: 'o3-2025-04-16',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a technical documentation expert specializing in data pipeline and analytics code documentation for a business audience. Your task is to help business users understand Python code related to sales representative activities with doctors and hospitals. You create comprehensive, structured documentation that follows specific business templates for data processing workflows, ensuring all KPIs are explained in their business context. You must explain technical steps in terms of their business impact and logic.',
        },
        {
          role: 'user',
          content: `${DOCUMENTATION_TEMPLATE}

Python file: ${filename}

Python Code:
\`\`\`python
${pythonCode}
\`\`\`

Please generate the documentation following the exact template format provided above.`,
        },
      ],
    });

    const documentationString = completion.choices[0]?.message?.content;

    if (!documentationString) {
      return NextResponse.json({ error: 'Failed to generate documentation' }, { status: 500 });
    }

    try {
      const documentationJson = JSON.parse(documentationString);

      const doc = createDocxFromDocumentation(documentationJson, filename);
      const buffer = await Packer.toBuffer(doc);

      return new NextResponse(buffer, {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${filename.replace('.py', '')}_documentation.docx"`,
        },
      });
    } catch (err) {
      console.error('Failed to parse JSON for DOCX:', err);
      return NextResponse.json({ error: 'Failed to parse documentation' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error generating documentation:', error);
    return NextResponse.json({ error: 'Failed to generate documentation' }, { status: 500 });
  }
} 