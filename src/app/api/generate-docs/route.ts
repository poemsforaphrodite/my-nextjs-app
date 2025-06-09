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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DOCUMENTATION_TEMPLATE = `
Please analyze the following Python code and generate comprehensive documentation using this exact format.
This template has been updated to test Git deployment with the correct GitHub account:

Dataset Name: [Extract or infer dataset name]	Market: -	Primary Owner: ZS	Refresh Frequency: Daily/Weekly/Monthly

Schema_name.table_name	-	ZS	Daily/Weekly/Monthly

1. Summary
1.1 Description
{Provide a detailed description of what this Python code does, its purpose, and its role in data processing pipeline}

1.2 Table Grain 
{Identify the grain/level at which data is processed - what are the key identifiers or dimensions}

1.3 Input Datasets
{List all input data sources, files, databases, APIs, or datasets that this code reads from}

1.4 Output Datasets
{List all output datasets, files, or data structures that this code generates}
Table_Name	Table Description
[table_name]	[Brief description of what this table contains and its purpose]

2. Process Flow & Steps Performed
2.1 High Level Process Flow 
{Provide a clear, numbered list of high-level steps that describe what the code does from start to finish}

2.2 Steps performed in the code
{Create a detailed table with the following columns: Step, Description, Input Tables/Data, Join Conditions/Operations, Business Definition}

Step	Description	Input Tables/Data	Join Conditions/Operations	Business Definition
1	[Step description]	[Input data sources]	[How data is combined/processed]	[Business logic explanation]
2	[Step description]	[Input data sources]	[How data is combined/processed]	[Business logic explanation]
[Continue for all major steps...]

3. KPIs & Business Definitions
{List all calculated fields, flags, metrics, and key business logic with their definitions}

KPI/Field	Business Definition
[field_name]	[Clear explanation of how this field is calculated and what it represents]
[flag_name]	[Explanation of when this flag is set and its business meaning]
[metric_name]	[Definition of the metric and its calculation logic]

Please analyze the code thoroughly and provide specific, accurate information based on the actual code structure and logic.
`;

function createDocxFromDocumentation(documentation: string, filename: string) {
  const lines = documentation.split('\n');
  const children: (Paragraph | Table)[] = [];

  // Document title and header
  children.push(new Paragraph({
    children: [
      new TextRun({
        text: `Python Documentation Report`,
        bold: true,
        size: 32,
        color: "2E86AB"
      })
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 }
  }));

  children.push(new Paragraph({
    children: [
      new TextRun({
        text: `Generated for: ${filename}`,
        size: 24,
        color: "666666",
        italics: true
      })
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 }
  }));

  // Add horizontal line
  children.push(new Paragraph({
    children: [new TextRun({ text: "", size: 1 })],
    border: {
      bottom: {
        color: "2E86AB",
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6
      }
    },
    spacing: { after: 400 }
  }));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) {
      children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      continue;
    }

    // Dataset header with special formatting
    if (line.match(/^Dataset Name:/)) {
      const parts = line.split('\t');
      if (parts.length > 1) {
        children.push(createInfoTable(parts));
      } else {
        children.push(new Paragraph({
          children: [
            new TextRun({
              text: line,
              bold: true,
              size: 28,
              color: "2E86AB"
            })
          ],
          spacing: { before: 400, after: 300 },
          alignment: AlignmentType.LEFT
        }));
      }
    }
    // Main headers (1., 2., 3.)
    else if (line.match(/^\d+\.\s/)) {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: line,
            bold: true,
            size: 24,
            color: "1B5E20"
          })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 600, after: 300 }
      }));
    }
    // Sub headers (1.1, 1.2, etc.)
    else if (line.match(/^\d+\.\d+\s/)) {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: line,
            bold: true,
            size: 20,
            color: "2E7D32"
          })
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
      }));
    }
    // Sub-sub headers (1.1.1, etc.)
    else if (line.match(/^\d+\.\d+\.\d+\s/)) {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: line,
            bold: true,
            size: 18,
            color: "388E3C"
          })
        ],
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 300, after: 150 }
      }));
    }
    // Tables
    else if (line.includes('\t') && (line.includes('Step') || line.includes('Table_Name') || line.includes('KPI') || line.includes('Field'))) {
      const tableData = parseTableData(lines, i);
      children.push(createStyledTable(tableData.rows));
      i = tableData.endIndex - 1;
    }
    // Bullet points with icons
    else if (line.startsWith('•') || line.startsWith('🔹')) {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: `▪ ${line.substring(1).trim()}`,
            size: 22,
            color: "424242"
          })
        ],
        spacing: { after: 120, before: 60 },
        indent: { left: convertInchesToTwip(0.25) }
      }));
    }
    // Code blocks or examples
    else if (line.startsWith('{') && line.endsWith('}')) {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: line,
            size: 20,
            color: "D32F2F",
            italics: true
          })
        ],
        spacing: { after: 200, before: 100 },
        indent: { left: convertInchesToTwip(0.5) }
      }));
    }
    // Regular paragraphs with better formatting
    else {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: line,
            size: 22,
            color: "212121"
          })
        ],
        spacing: { after: 150, before: 50 },
        alignment: AlignmentType.JUSTIFIED
      }));
    }
  }

  return new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1)
          }
        }
      },
      children: children
    }]
  });
}

function createInfoTable(data: string[]) {
  const headers = ['Dataset Name', 'Market', 'Primary Owner', 'Refresh Frequency'];
  
  return new Table({
    rows: [
      new TableRow({
        children: headers.map(header => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ 
              text: header, 
              bold: true, 
              color: "FFFFFF",
              size: 20
            })],
            alignment: AlignmentType.CENTER
          })],
          shading: { fill: "2E86AB", type: ShadingType.SOLID },
          margins: { top: 200, bottom: 200, left: 200, right: 200 }
        }))
      }),
      new TableRow({
        children: data.map((cell) => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ 
              text: cell.split(':')[1]?.trim() || cell.trim(),
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

function parseTableData(lines: string[], startIndex: number) {
  const rows: string[][] = [];
  let i = startIndex;
  
  while (i < lines.length && lines[i].trim() && lines[i].includes('\t')) {
    const cells = lines[i].trim().split('\t');
    if (cells.length > 1) {
      rows.push(cells);
    }
    i++;
  }
  
  return { rows, endIndex: i };
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
            color: "FFFFFF",
            size: 20
          })],
          alignment: AlignmentType.CENTER
        })],
        shading: { fill: "1B5E20", type: ShadingType.SOLID },
        margins: { top: 200, bottom: 200, left: 200, right: 200 },
        width: { size: 100 / headerRow.length, type: WidthType.PERCENTAGE }
      }))
    }),
    // Data rows
    ...dataRows.map((row, index) => new TableRow({
      children: row.map(cell => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ 
            text: cell.trim(),
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
    const { pythonCode, filename } = await request.json();

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

    const documentation = completion.choices[0]?.message?.content;

    if (!documentation) {
      return NextResponse.json(
        { error: 'Failed to generate documentation' },
        { status: 500 }
      );
    }

    // Create DOCX document
    const doc = createDocxFromDocumentation(documentation, filename);
    const buffer = await Packer.toBuffer(doc);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename.replace('.py', '')}_documentation.docx"`,
      },
    });

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