import { describe, it, expect } from 'vitest';
import { createDocxFromDocumentation } from '@/lib/docx-util';
import { Packer } from 'docx';

const sampleDoc = {
  description: 'Test description',
  tableGrain: 'id',
  dataSources: ['src_table'],
  databricksTables: [
    {
      tableName: 'out_table',
      description: 'output table'
    }
  ],
  tableMetadata: [
    {
      tableName: 'out_table',
      columns: [
        {
          columnName: 'id',
          dataType: 'integer',
          description: 'primary key',
          sampleValues: '1,2,3',
          sourceTable: 'src_table',
          sourceColumn: 'id'
        }
      ]
    }
  ],
  integratedRules: ['rule 1']
};

describe('Docx generator', () => {
  it('should create a non-empty docx buffer', async () => {
    const doc = createDocxFromDocumentation(sampleDoc as any, 'sample.py');
    const buf = await Packer.toBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
}); 