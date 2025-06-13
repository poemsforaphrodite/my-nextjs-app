import { describe, it, expect, beforeAll } from 'vitest';
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

describe('Documentation Generator', () => {
  beforeAll(() => {
    // Check for required environment variables
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set - using test value');
      process.env.OPENAI_API_KEY = 'sk-test-key-for-local-testing';
    }
  });

  it('should create a non-empty docx buffer', async () => {
    const doc = createDocxFromDocumentation(sampleDoc as any, 'sample.py');
    const buf = await Packer.toBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(1000);
    console.log(`Generated DOCX buffer size: ${buf.byteLength} bytes`);
  });

  it('should handle empty documentation gracefully', async () => {
    const emptyDoc = {
      description: '',
      tableGrain: '',
      dataSources: [],
      databricksTables: [],
      tableMetadata: [],
      integratedRules: []
    };
    
    const doc = createDocxFromDocumentation(emptyDoc as any, 'empty.py');
    const buf = await Packer.toBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(500);
  });
}); 