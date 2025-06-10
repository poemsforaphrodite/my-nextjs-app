'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Download, CheckCircle, X, Heart } from 'lucide-react';
import { saveAs } from 'file-saver';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';

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
      description: string;
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

// Documentation Viewer Component using shadcn/ui
const DocumentationViewer = ({ 
  documentation, 
  onDownload, 
  isDownloading,
  filename 
}: { 
  documentation: Documentation;
  onDownload: () => void;
  isDownloading: boolean;
  filename: string;
}) => {
  if (!documentation) return null;

  const { datasetInfo, summary, processFlow, kpisAndBusinessDefinitions } = documentation;

  return (
    <div className="mt-8 space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-2xl">Generated Documentation</CardTitle>
            <CardDescription>
              Comprehensive documentation generated from {filename}
            </CardDescription>
          </div>
          <Button 
            onClick={onDownload} 
            disabled={isDownloading}
            className="min-w-[150px]"
          >
            {isDownloading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Download DOCX
              </>
            )}
          </Button>
        </CardHeader>
      </Card>

      {/* Dataset Information */}
      {datasetInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Dataset Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Badge variant="secondary">Dataset Name</Badge>
                <p className="text-sm font-medium">{datasetInfo.datasetName || 'N/A'}</p>
              </div>
              <div className="space-y-2">
                <Badge variant="secondary">Market</Badge>
                <p className="text-sm font-medium">{datasetInfo.market || 'N/A'}</p>
              </div>
              <div className="space-y-2">
                <Badge variant="secondary">Primary Owner</Badge>
                <p className="text-sm font-medium">{datasetInfo.primaryOwner || 'N/A'}</p>
              </div>
              <div className="space-y-2">
                <Badge variant="secondary">Refresh Frequency</Badge>
                <p className="text-sm font-medium">{datasetInfo.refreshFrequency || 'N/A'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Section */}
      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>1. Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h4 className="text-lg font-semibold mb-2">1.1 Description</h4>
              <p className="text-muted-foreground">{summary.description}</p>
            </div>
            
            <Separator />
            
            <div>
              <h4 className="text-lg font-semibold mb-2">1.2 Table Grain</h4>
              <p className="text-muted-foreground">{summary.tableGrain}</p>
            </div>
            
            <Separator />
            
            <div>
              <h4 className="text-lg font-semibold mb-2">1.3 Input Datasets</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                {summary.inputDatasets?.map((dataset, index) => (
                  <li key={index}>{dataset}</li>
                ))}
              </ul>
            </div>
            
            <Separator />
            
            <div>
              <h4 className="text-lg font-semibold mb-4">1.4 Output Datasets</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Table Name</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.outputDatasets?.map((dataset, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{dataset.tableName}</TableCell>
                      <TableCell>{dataset.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Process Flow Section */}
      {processFlow && (
        <Card>
          <CardHeader>
            <CardTitle>2. Process Flow & Steps Performed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h4 className="text-lg font-semibold mb-2">2.1 High Level Process Flow</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                {processFlow.highLevelProcessFlow?.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ul>
            </div>
            
            <Separator />
            
            <div>
              <h4 className="text-lg font-semibold mb-4">2.2 Steps performed in the code</h4>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Step</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Input Tables/Data</TableHead>
                      <TableHead>Join Conditions/Operations</TableHead>
                      <TableHead>Business Definition</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processFlow.stepsPerformed?.map((step, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{step.step}</TableCell>
                        <TableCell>{step.description}</TableCell>
                        <TableCell>{step.inputTablesData}</TableCell>
                        <TableCell>{step.joinConditionsOperations}</TableCell>
                        <TableCell>{step.businessDefinition}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPIs & Business Definitions */}
      {kpisAndBusinessDefinitions && (
        <Card>
          <CardHeader>
            <CardTitle>3. KPIs & Business Definitions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>KPI/Field</TableHead>
                  <TableHead>Business Definition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpisAndBusinessDefinitions.kpis?.map((kpi, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{kpi.kpiField}</TableCell>
                    <TableCell>{kpi.businessDefinition}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
      
      // Generate JSON documentation for UI display
      const response = await fetch('/api/generate-docs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pythonCode: fileContent,
          filename: file.name,
          format: 'json'
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to generate documentation');
      }

      const data = await response.json();
      setDocumentation(data);
      setSuccessMessage(`Documentation generated successfully! You can view it below or download it as a DOCX file.`);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadDocumentation = async () => {
    if (!file) return;

    setIsDownloading(true);
    setError('');
    
    try {
      const fileContent = await file.text();
      
      // Generate DOCX file for download
      const response = await fetch('/api/generate-docs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pythonCode: fileContent,
          filename: file.name,
          format: 'docx'
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
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary p-3">
              <FileText className="w-8 h-8 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Python Documentation Generator
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Transform your Python code into comprehensive, professional documentation 
            using AI-powered analysis
          </p>
        </div>

        {/* Main Upload Card */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Upload Python File</CardTitle>
            <CardDescription>
              Upload your Python (.py) file to generate comprehensive documentation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-200 ${
                isDragActive
                  ? 'border-primary bg-primary/5 scale-[1.02]'
                  : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
              }`}
            >
              <input {...getInputProps()} />
              
              {file ? (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <div className="rounded-full bg-green-100 p-3">
                      <CheckCircle className="w-8 h-8 text-green-600" />
                    </div>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground mb-1">
                      {file.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Size: {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                  >
                    Choose a different file
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Upload className="mx-auto w-12 h-12 text-muted-foreground" />
                  <div>
                    <p className="text-lg font-semibold text-foreground mb-1">
                      {isDragActive ? 'Drop your Python file here' : 'Upload Python File'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Drag & drop or click to browse • Only .py files accepted
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Status Messages */}
            {error && (
              <Alert variant="destructive" className="mt-4">
                <X className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {successMessage && (
              <Alert className="mt-4 border-green-200 bg-green-50 text-green-800">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            )}

            {/* Generate Button */}
            {file && (
              <div className="mt-6 p-4 bg-muted rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold mb-1">Ready to Generate Documentation</h3>
                    <p className="text-sm text-muted-foreground">
                      Your file will be analyzed using AI to create comprehensive documentation
                    </p>
                  </div>
                  <Button
                    onClick={generateDocumentation}
                    disabled={isProcessing}
                    size="lg"
                    className="min-w-[200px]"
                  >
                    {isProcessing ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4 mr-2" />
                        Generate Documentation
                      </>
                    )}
                  </Button>
                </div>
                
                {isProcessing && (
                  <div className="mt-4">
                    <Progress value={33} className="w-full" />
                    <p className="text-xs text-muted-foreground mt-1">
                      Analyzing code and generating documentation...
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documentation Viewer */}
        {documentation && file && (
          <DocumentationViewer 
            documentation={documentation} 
            onDownload={downloadDocumentation} 
            isDownloading={isDownloading}
            filename={file.name}
          />
        )}

        {/* Features Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center space-y-2">
                <div className="rounded-full bg-blue-100 p-3">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold">AI-Powered Analysis</h3>
                <p className="text-sm text-muted-foreground">
                  Advanced AI analyzes your code structure, logic, and data flow
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center space-y-2">
                <div className="rounded-full bg-green-100 p-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="font-semibold">Professional Format</h3>
                <p className="text-sm text-muted-foreground">
                  Structured documentation with tables, sections, and proper formatting
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center space-y-2">
                <div className="rounded-full bg-purple-100 p-3">
                  <Download className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="font-semibold">DOCX Export</h3>
                <p className="text-sm text-muted-foreground">
                  Download ready-to-use Word documents for sharing and collaboration
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer with Attribution */}
        <footer className="mt-16 py-8 border-t border-muted">
          <div className="text-center">
            <p className="text-muted-foreground flex items-center justify-center gap-2">
              Made with <Heart className="w-4 h-4 fill-red-500 text-red-500" /> by{' '}
              <span className="font-semibold text-foreground">Pushpender Solanki</span>{' '}
              <Badge variant="secondary">@ZS</Badge>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
