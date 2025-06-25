import { Document, Paragraph, Table, TextRun, HeadingLevel, AlignmentType, BorderStyle, WidthType, TableRow, TableCell, convertInchesToTwip } from 'docx';

export interface Documentation {
  description: string;
  tableGrain: string;
  dataSources: string[];
  databricksTables: { tableName: string; description: string }[];
  tableMetadata: {
    tableName: string;
    columns: {
      columnName: string;
      dataType: string;
      description: string;
      sampleValues: string;
      sourceTable: string;
      sourceColumn: string;
    }[];
  }[];
  integratedRules: string[];
}

function createSectionHeader(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28, color: '1B5E20' })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 600, after: 300 },
    border: { bottom: { color: '1B5E20', size: 4, space: 1, style: BorderStyle.SINGLE } },
  });
}
function _createSubHeader(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24, color: '2E7D32' })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 200 },
  });
}
function createParagraph(text: string): Paragraph {
  if (!text || text.trim() === '') return new Paragraph({ text: ' ' });
  return new Paragraph({
    children: [new TextRun({ text: text.trim(), size: 22, color: '212121' })],
    spacing: { after: 150, before: 50 },
    alignment: AlignmentType.JUSTIFIED,
  });
}
function createBullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text || '', size: 22, color: '424242' })],
    bullet: { level: 0 },
    spacing: { after: 120, before: 60 },
    indent: { left: convertInchesToTwip(0.25) },
  });
}
function createStyledTable(rows: string[][]) {
  if (rows.length === 0) return new Paragraph({ text: '' });
  const [headerRow, ...dataRows] = rows;
  return new Table({
    rows: [
      new TableRow({
        children: headerRow.map((cell) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: (cell || '').trim(), bold: true, color: '2C2C2C', size: 20 })],
                alignment: AlignmentType.CENTER,
              }),
            ],
            shading: { fill: 'FFFFFF' },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            width: { size: 100 / headerRow.length, type: WidthType.PERCENTAGE },
          })
        ),
      }),
      ...dataRows.map((row, idx) =>
        new TableRow({
          children: row.map((cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: (cell || '').trim(), size: 20, color: '2C2C2C' })],
                  alignment: AlignmentType.LEFT,
                }),
              ],
              shading: { fill: idx % 2 === 0 ? 'F7F7F7' : 'FFFFFF' },
              margins: { top: 150, bottom: 150, left: 200, right: 200 },
              width: { size: 100 / headerRow.length, type: WidthType.PERCENTAGE },
            })
          ),
        })
      ),
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    },
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

export function createDocxFromDocumentation(doc: Documentation, filename: string) {
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'Python Documentation Report', bold: true, size: 36, color: '2E86AB' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Generated for: ${filename}`, size: 24, color: '666666', italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: '', size: 1 })],
      border: { bottom: { color: '2E86AB', space: 1, style: BorderStyle.SINGLE, size: 6 } },
      spacing: { after: 400 },
    })
  );

  children.push(createSectionHeader('1. Description'));
  children.push(createParagraph(doc.description));

  children.push(createSectionHeader('2. Table Grain'));
  children.push(createParagraph(doc.tableGrain));

  children.push(createSectionHeader('3. Data Sources'));
  if (doc.dataSources?.length) doc.dataSources.forEach((s) => children.push(createBullet(s)));
  else children.push(createParagraph('No data sources identified.'));

  children.push(createSectionHeader('4. Databricks Tables (Output)'));
  if (doc.databricksTables?.length) {
    children.push(
      createStyledTable([
        ['Table Name', 'Description'],
        ...doc.databricksTables.map((t) => [t.tableName, t.description]),
      ])
    );
  } else children.push(createParagraph('No Databricks tables specified.'));

  children.push(createSectionHeader('5. Table Metadata'));
  if (doc.tableMetadata?.length) {
    doc.tableMetadata.forEach((tbl) => {
      children.push(_createSubHeader(`Table: ${tbl.tableName}`));
      children.push(
        createStyledTable([
          ['Column Name', 'Data Type', 'Description', 'Sample Values', 'Source Table', 'Source Column'],
          ...tbl.columns.map((c) => [
            c.columnName,
            c.dataType,
            c.description,
            c.sampleValues,
            c.sourceTable,
            c.sourceColumn,
          ]),
        ])
      );
    });
  } else children.push(createParagraph('No table metadata provided.'));

  children.push(createSectionHeader('6. Integrated Rules'));
  if (doc.integratedRules?.length) doc.integratedRules.forEach((r) => children.push(createBullet(r)));
  else children.push(createParagraph('No rules described.'));

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