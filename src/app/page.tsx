'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { ArrowUpTrayIcon, DocumentTextIcon, ArrowDownTrayIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { saveAs } from 'file-saver';

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

// New component to display the structured documentation
const DocumentationViewer = ({ documentation, onDownload, isDownloading }: { documentation: Documentation, onDownload: () => void, isDownloading: boolean }) => {
  if (!documentation) return null;

  const { datasetInfo, summary, processFlow, kpisAndBusinessDefinitions } = documentation;

  const Section = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div className="mb-8">
      <h2 className="text-3xl font-bold text-gray-800 border-b-2 border-gray-200 pb-2 mb-4">{title}</h2>
      {children}
    </div>
  );

  const SubSection = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div className="mb-6">
      <h3 className="text-2xl font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );

  const Table = ({ headers, data }: { headers: string[], data: (string | number)[][] }) => (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-white border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            {headers.map(h => <th key={h} className="text-left font-semibold text-gray-600 p-3 border-b">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {row.map((cell, j) => <td key={j} className="p-3 border-t">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mt-12 p-8 bg-white rounded-2xl shadow-lg border border-gray-200">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900">Generated Documentation</h1>
        <button
          onClick={onDownload}
          disabled={isDownloading}
          className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all duration-300 shadow-md hover:shadow-lg disabled:cursor-not-allowed"
        >
          {isDownloading ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
              Downloading...
            </>
          ) : (
            <>
              <ArrowDownTrayIcon className="w-5 h-5" />
              Download DOCX
            </>
          )}
        </button>
      </div>

      {datasetInfo && (
        <Section title="Dataset Information">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-800 font-semibold">Dataset Name</p><p>{datasetInfo.datasetName}</p></div>
                <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-800 font-semibold">Market</p><p>{datasetInfo.market}</p></div>
                <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-800 font-semibold">Primary Owner</p><p>{datasetInfo.primaryOwner}</p></div>
                <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-800 font-semibold">Refresh Frequency</p><p>{datasetInfo.refreshFrequency}</p></div>
            </div>
        </Section>
      )}

      {summary && (
        <Section title="1. Summary">
          <SubSection title="1.1 Description"><p>{summary.description}</p></SubSection>
          <SubSection title="1.2 Table Grain"><p>{summary.tableGrain}</p></SubSection>
          <SubSection title="1.3 Input Datasets">
            <ul className="list-disc list-inside">{summary.inputDatasets?.map((d:string, i:number) => <li key={i}>{d}</li>)}</ul>
          </SubSection>
          <SubSection title="1.4 Output Datasets">
            <Table headers={['Table Name', 'Description']} data={summary.outputDatasets?.map((d) => [d.tableName, d.description]) || []} />
          </SubSection>
        </Section>
      )}

      {processFlow && (
        <Section title="2. Process Flow & Steps Performed">
          <SubSection title="2.1 High Level Process Flow">
            <ul className="list-disc list-inside">{processFlow.highLevelProcessFlow?.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
          </SubSection>
          <SubSection title="2.2 Steps performed in the code">
            <Table 
              headers={['Step', 'Description', 'Input Tables/Data', 'Join Conditions/Operations', 'Business Definition']} 
              data={processFlow.stepsPerformed?.map((s) => [s.step, s.description, s.inputTablesData, s.joinConditionsOperations, s.businessDefinition]) || []} 
            />
          </SubSection>
        </Section>
      )}

      {kpisAndBusinessDefinitions && (
        <Section title="3. KPIs & Business Definitions">
          <Table 
            headers={['KPI/Field', 'Business Definition']}
            data={kpisAndBusinessDefinitions.kpis?.map((k) => [k.kpiField, k.businessDefinition]) || []}
          />
        </Section>
      )}
    </div>
  );
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [documentation, setDocumentation] = useState<Documentation | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const uploadedFile = acceptedFiles[0];
    if (uploadedFile && uploadedFile.name.endsWith('.py')) {
      setFile(uploadedFile);
      setError('');
      setDocumentation(null);
      setSuccessMessage('');
    } else {
      setError('Please upload a Python (.py) file');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/x-python': ['.py'],
    },
    multiple: false,
  });

  const generateDocumentation = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError('');
    setSuccessMessage('');
    setDocumentation(null);

    try {
      const fileContent = await file.text();
      
      const response = await fetch('/api/generate-docs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pythonCode: fileContent,
          filename: file.name,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to generate documentation');
      }

      const data = await response.json();
      setDocumentation(data);
      setSuccessMessage(`Documentation generated successfully! You can now view it below or download it as a DOCX file.`);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadDocumentation = async () => {
    if (!file || !documentation) return;

    setIsDownloading(true);
    setError('');
    
    try {
      const response = await fetch('/api/generate-docs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create-docx',
          documentation: documentation,
          filename: file.name,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to download documentation');
      }

      const blob = await response.blob();
      const filename = `${file.name.replace('.py', '')}_documentation.docx`;
      saveAs(blob, filename);
      setSuccessMessage(`Documentation downloaded successfully as ${filename}`);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-6">
              <DocumentTextIcon className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              Python Documentation Generator
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Transform your Python code into comprehensive, professional documentation 
              using AI-powered analysis
            </p>
          </div>

          {/* Main Content Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
            {/* Upload Section */}
            <div className="p-8">
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-300 ${
                  isDragActive
                    ? 'border-blue-400 bg-blue-50 scale-105'
                    : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                }`}
              >
                <input {...getInputProps()} />
                
                {file ? (
                  <div className="space-y-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full">
                      <CheckCircleIcon className="w-8 h-8 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xl font-semibold text-gray-800 mb-2">
                        {file.name}
                      </p>
                      <p className="text-gray-500">
                        Size: {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                    <button
                      onClick={() => setFile(null)}
                      className="text-blue-600 hover:text-blue-700 underline"
                    >
                      Choose a different file
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <ArrowUpTrayIcon className="mx-auto w-16 h-16 text-gray-400" />
                    <div>
                      <p className="text-xl font-semibold text-gray-700 mb-2">
                        {isDragActive ? 'Drop your Python file here' : 'Upload Python File'}
                      </p>
                      <p className="text-gray-500">
                        Drag & drop or click to browse • Only .py files accepted
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Status Messages */}
              {error && (
                <div className="mt-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-3">
                  <XCircleIcon className="w-5 h-5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {successMessage && (
                <div className="mt-6 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg flex items-center gap-3">
                  <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}
            </div>

            {/* Action Section */}
            {file && !documentation && (
              <div className="px-8 pb-8">
                <div className="bg-gray-50 rounded-xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-2">
                        Ready to Generate Documentation
                      </h3>
                      <p className="text-gray-600">
                        Your file will be analyzed using AI to create comprehensive DOCX documentation
                      </p>
                    </div>
                    <button
                      onClick={generateDocumentation}
                      disabled={isProcessing}
                      className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white px-8 py-4 rounded-xl font-semibold flex items-center gap-3 transition-all duration-300 shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
                    >
                      {isProcessing ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                          Analyzing & Generating...
                        </>
                      ) : (
                        <>
                          <DocumentTextIcon className="w-5 h-5" />
                          Generate Documentation
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Documentation Viewer */}
          {documentation && <DocumentationViewer documentation={documentation} onDownload={downloadDocumentation} isDownloading={isDownloading} />}

          {/* Features Section */}
          <div className="mt-16 grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg mb-4">
                <DocumentTextIcon className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">AI-Powered Analysis</h3>
              <p className="text-gray-600">Advanced AI analyzes your code structure, logic, and data flow</p>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg mb-4">
                <CheckCircleIcon className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">Professional Format</h3>
              <p className="text-gray-600">Structured documentation with tables, sections, and proper formatting</p>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-purple-100 rounded-lg mb-4">
                <ArrowDownTrayIcon className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">DOCX Export</h3>
              <p className="text-gray-600">Download ready-to-use Word documents for sharing and collaboration</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
