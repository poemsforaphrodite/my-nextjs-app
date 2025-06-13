import { describe, it, expect, beforeAll } from 'vitest';
import { createDocxFromDocumentation } from '@/lib/docx-util';
import { Packer } from 'docx';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load real Python file for testing
const pythonCode = readFileSync(join(__dirname, 'sample_python_script.py'), 'utf8');

const sampleDoc = {
  description: 'Sales Representative Activity Analysis Pipeline - processes sales rep interactions with healthcare providers and generates comprehensive activity reports for business analysis',
  tableGrain: 'rep_id, provider_id, product_id',
  dataSources: [
    'healthcare_db.rep_interactions',
    'healthcare_db.healthcare_providers',
    'healthcare_db.sales_representatives', 
    'healthcare_db.products'
  ],
  databricksTables: [
    {
      tableName: 'analytics_db.rep_provider_interaction_metrics',
      description: 'Detailed interaction metrics between sales reps and healthcare providers'
    },
    {
      tableName: 'analytics_db.sales_rep_performance_summary',
      description: 'Summary of sales rep performance across all providers'
    },
    {
      tableName: 'analytics_db.provider_engagement_summary',
      description: 'Summary of healthcare provider engagement levels'
    }
  ],
  tableMetadata: [
    {
      tableName: 'analytics_db.rep_provider_interaction_metrics',
      columns: [
        {
          columnName: 'rep_id',
          dataType: 'string',
          description: 'Unique sales representative identifier',
          sampleValues: 'REP001, REP002, REP003',
          sourceTable: 'healthcare_db.sales_representatives',
          sourceColumn: 'rep_id'
        },
        {
          columnName: 'provider_id',
          dataType: 'string',
          description: 'Unique healthcare provider identifier',
          sampleValues: 'PROV001, PROV002, PROV003',
          sourceTable: 'healthcare_db.healthcare_providers',
          sourceColumn: 'provider_id'
        },
        {
          columnName: 'total_interactions',
          dataType: 'integer',
          description: 'Total number of interactions between rep and provider',
          sampleValues: '5, 12, 8',
          sourceTable: 'healthcare_db.rep_interactions',
          sourceColumn: 'interaction_id'
        },
        {
          columnName: 'engagement_score',
          dataType: 'string',
          description: 'Provider engagement level categorization',
          sampleValues: 'High, Medium, Low',
          sourceTable: 'calculated',
          sourceColumn: 'calculated'
        }
      ]
    }
  ],
  integratedRules: [
    'Filter interactions to last 90 days of activity only',
    'Join interaction data with provider, rep, and product details',
    'Calculate total interactions, contact time, and interaction types per rep-provider pair',
    'Categorize engagement scores: High (>=10 interactions), Medium (5-9), Low (<5)',
    'Calculate contact frequency as interactions per 90-day period',
    'Generate rep performance summary with unique providers contacted and interaction totals',
    'Generate provider engagement summary with unique reps engaged and engagement levels'
  ]
};

describe('Documentation Generator E2E Tests', () => {
  beforeAll(() => {
    // Check for required environment variables
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set - some tests may fail');
      process.env.OPENAI_API_KEY = 'sk-test-key-for-local-testing';
    }
  });

  it('should create DOCX from real documentation data', async () => {
    const doc = createDocxFromDocumentation(sampleDoc as any, 'sales_rep_analysis.py');
    const buf = await Packer.toBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(5000);
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

  it('should load real Python script for testing', () => {
    expect(pythonCode).toBeDefined();
    expect(pythonCode.length).toBeGreaterThan(1000);
    expect(pythonCode).toContain('Sales Representative Activity Analysis Pipeline');
    expect(pythonCode).toContain('healthcare_db.rep_interactions');
    expect(pythonCode).toContain('analytics_db.rep_provider_interaction_metrics');
    console.log(`Loaded Python script: ${pythonCode.length} characters`);
  });

  // This test would call the real API if OPENAI_API_KEY is set
  it.skipIf(!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-test'))('should process real Python file through OpenAI API', async () => {
    const response = await fetch('http://localhost:3000/api/openai-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pythonCode,
        filename: 'sales_rep_analysis.py'
      })
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    
    console.log('OpenAI API integration test passed');
  }, 30000); // 30 second timeout for API call
}); 