import { NextRequest, NextResponse } from 'next/server';
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
import { createDocxFromDocumentation } from '@/lib/docx-util';

// OpenAI calls will now be made client-side to avoid serverless timeouts

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
  }[];
  tableMetadata: {
    tableName: string; // Output table name
    columns: {
      columnName: string;
      dataType: string;
      description: string;
      sampleValues: string;
      sourceTable: string;
      sourceColumn: string;
    }[];
  }[]; // Metadata grouped by table
  integratedRules: string[]; // Bullet list describing the data transformation / business rules applied
  kpis: {
    name: string;
    definition: string;
    calculationLogic: string;
    businessPurpose: string;
    dataSource: string;
    frequency: string;
    owner: string;
    tags: string[];
  }[];
}

// Documentation template moved to openai-proxy route

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

function _legacyDocxFactory(documentation: Documentation, filename: string) {
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

  // 5. Table Metadata (grouped per table)
  children.push(createSectionHeader("5. Table Metadata"));
  if (documentation.tableMetadata && documentation.tableMetadata.length > 0) {
    documentation.tableMetadata.forEach((tblMeta) => {
      // Sub-header per table
      children.push(_createSubHeader(`Table: ${tblMeta.tableName}`));
      const rows: string[][] = [
        [
          "Column Name",
          "Data Type",
          "Description",
          "Sample Values",
          "Source Table",
          "Source Column",
        ],
        ...tblMeta.columns.map((c) => [
          c.columnName,
          c.dataType,
          c.description,
          c.sampleValues,
          c.sourceTable,
          c.sourceColumn,
        ]),
      ];
      children.push(createStyledTable(rows));
    });
  } else {
    children.push(createParagraph("No table metadata provided."));
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
              color: "2C2C2C",
              size: 20
            })],
            alignment: AlignmentType.CENTER
          })],
          shading: { fill: "FFFFFF" },
          margins: { top: 200, bottom: 200, left: 200, right: 200 }
        }))
      }),
      new TableRow({
        children: values.map((cell) => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ 
              text: cell || '',
              size: 20,
              color: "2C2C2C"
            })],
            alignment: AlignmentType.CENTER
          })],
          shading: { fill: "FFFFFF" },
          margins: { top: 200, bottom: 200, left: 200, right: 200 }
        }))
      })
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
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
            color: "2C2C2C",
            size: 20
          })],
          alignment: AlignmentType.CENTER
        })],
        shading: { fill: "FFFFFF" },
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
            color: "2C2C2C"
          })],
          alignment: AlignmentType.LEFT
        })],
        shading: { 
          fill: index % 2 === 0 ? "F7F7F7" : "FFFFFF"
        },
        margins: { top: 150, bottom: 150, left: 200, right: 200 },
        width: { size: 100 / headerRow.length, type: WidthType.PERCENTAGE }
      }))
    }))
  ];

  return new Table({
    rows: docRows,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" }
    },
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { documentation, filename, format } = body;

  // Basic payload validation
  if (!documentation) {
    return NextResponse.json({ error: 'documentation missing' }, { status: 400 });
  }

  // For DOCX generation only (JSON documentation is now passed from client)
  if (format === 'docx') {
    try {
      const doc = createDocxFromDocumentation(documentation, filename || 'documentation');
      const buffer = await Packer.toBuffer(doc);

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${(filename || 'documentation').replace('.py', '')}_documentation.docx"`,
        },
      });
    } catch (err) {
      console.error('Failed to generate DOCX', err);
      return NextResponse.json({ error: 'Failed to generate documentation' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
}

// All OpenAI processing now happens client-side to avoid serverless timeouts 