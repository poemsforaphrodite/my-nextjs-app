'use client';

import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Download, CheckCircle, X, Heart, MessageSquare, TrendingUp } from 'lucide-react';
import { saveAs } from 'file-saver';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ChatInterface from '@/components/chat-interface';
import * as XLSX from 'xlsx';
import { decodeSSE } from '@/lib/utils';
import { extractSections, ExtractedSections } from '@/lib/docx-util';

interface Documentation {
  description: string;
  tableGrain: string;
  dataSources: string[];
  databricksTables: {
    tableName: string;
    description: string;
  }[];
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

// Documentation Viewer Component using shadcn/ui
const DocumentationViewer = ({ 
  documentation, 
  onDownload, 
  isDownloading,
  filename,
  onChatFeedback,
  file
}: { 
  documentation: Documentation;
  onDownload: () => void;
  isDownloading: boolean;
  filename: string;
  onChatFeedback: (feedback: string) => void;
  file: File | null;
}) => {
  const [isApproving, setIsApproving] = useState(false);
  const [hasApproved, setHasApproved] = useState(false);
  const [showChat, setShowChat] = useState(false);

  if (!documentation) return null;

  const { description, tableGrain, dataSources, databricksTables, tableMetadata, integratedRules, kpis } = documentation;

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      // Store only KPIs in RAG for future reference (as requested)
      if (documentation.kpis && documentation.kpis.length > 0) {
        const kpiResponse = await fetch('/api/knowledge-base/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: JSON.stringify(documentation.kpis),
            filename: `${filename.replace('.py', '')}_kpis.json`,
            contentType: 'kpi',
            metadata: { 
              generatedFrom: filename, 
              timestamp: new Date().toISOString(),
              totalKpis: documentation.kpis.length,
              userApproved: true
            }
          })
        });
        if (!kpiResponse.ok) throw new Error('KPI ingestion failed');
        console.log('KPIs approved and stored in knowledge base for future reference');
      } else {
        console.log('No KPIs to store');
      }

      setHasApproved(true);
    } catch (error) {
      console.error('KPI ingestion error:', error);
    } finally {
      setIsApproving(false);
    }
  };

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
          <div className="flex gap-2">
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
            <Button
              onClick={handleApprove}
              disabled={isApproving || hasApproved}
              className="min-w-[150px]"
              variant={hasApproved ? "secondary" : "default"}
            >
              {isApproving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                  Approving...
                </>
              ) : hasApproved ? (
                'KPIs Stored'
              ) : (
                'Store KPIs'
              )}
            </Button>
            <Button
              onClick={() => setShowChat(!showChat)}
              variant="outline"
              className="min-w-[150px]"
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              {showChat ? 'Hide Chat' : 'Chat & Feedback'}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* 1. Description */}
      <Card>
        <CardHeader>
          <CardTitle>1. Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground whitespace-pre-line">{description}</p>
        </CardContent>
      </Card>

      {/* 2. Table Grain */}
      <Card>
        <CardHeader>
          <CardTitle>2. Table Grain</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{tableGrain}</p>
        </CardContent>
      </Card>

      {/* 3. Data Sources */}
      <Card>
        <CardHeader>
          <CardTitle>3. Data Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            {dataSources?.map((src, idx) => (
              <li key={idx}>{src}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* 4. Databricks Tables */}
      <Card>
        <CardHeader>
          <CardTitle>4. Databricks Tables (Output)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table Name</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {databricksTables?.map((tbl, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium">{tbl.tableName}</TableCell>
                  <TableCell>{tbl.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 5. Table Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>5. Table Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {tableMetadata?.map((tbl, tblIdx) => (
            <div key={tblIdx} className="space-y-4">
              <h4 className="text-lg font-semibold">Table: {tbl.tableName}</h4>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column Name</TableHead>
                      <TableHead>Data Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Sample Values</TableHead>
                      <TableHead>Source Table</TableHead>
                      <TableHead>Source Column</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tbl.columns.map((col, colIdx) => (
                      <TableRow key={colIdx}>
                        <TableCell className="font-medium whitespace-nowrap">{col.columnName}</TableCell>
                        <TableCell>{col.dataType}</TableCell>
                        <TableCell>{col.description}</TableCell>
                        <TableCell>{col.sampleValues}</TableCell>
                        <TableCell>{col.sourceTable}</TableCell>
                        <TableCell>{col.sourceColumn}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 6. Integrated Rules */}
      <Card>
        <CardHeader>
          <CardTitle>6. Integrated Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            {integratedRules?.map((rule, idx) => (
              <li key={idx}>{rule}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* 7. KPIs */}
      {kpis && kpis.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              7. Key Performance Indicators (KPIs)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              {kpis.map((kpi, idx) => (
                <div key={idx} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <h4 className="text-lg font-semibold">{kpi.name}</h4>
                    <div className="flex gap-1">
                      {kpi.tags?.map((tag, tagIdx) => (
                        <Badge key={tagIdx} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Definition</p>
                      <p className="text-sm">{kpi.definition}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Business Purpose</p>
                      <p className="text-sm">{kpi.businessPurpose}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Calculation Logic</p>
                      <p className="text-sm font-mono bg-muted p-2 rounded">{kpi.calculationLogic}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Data Source</p>
                      <p className="text-sm">{kpi.dataSource}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Frequency</p>
                      <p className="text-sm">{kpi.frequency}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Owner</p>
                      <p className="text-sm">{kpi.owner}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chat Interface */}
      {showChat && (
        <Card>
          <CardHeader>
            <CardTitle>Chat & Feedback</CardTitle>
            <CardDescription>
              Ask questions about the documentation or provide feedback for improvements
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChatInterface
              onMessage={(message) => onChatFeedback(message)}
              className="h-96"
              context={{
                hasDocumentation: !!documentation,
                filename: file?.name,
                documentation: documentation as unknown as Record<string, unknown>
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null); // Python file
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [documentation, setDocumentation] = useState<Documentation | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>('');

  const handleChatFeedback = async (feedback: string) => {
    // Handle special chat commands
    if (feedback === 'DOCUMENTATION_UPDATED') {
      // This is a signal from the chat interface that documentation was updated
      // The actual update will come through the chat interface's SSE stream
      setSuccessMessage('Documentation has been updated based on your chat feedback!');
      return;
    }

    // Handle documentation updates with actual documentation data
    try {
      const parsedFeedback = JSON.parse(feedback);
      if (parsedFeedback.type === 'DOCUMENTATION_UPDATED' && parsedFeedback.documentation) {
        console.log('Real-time documentation update received:', parsedFeedback.documentation);
        setDocumentation(parsedFeedback.documentation);
        setSuccessMessage('Documentation has been updated based on your chat feedback!');
        // Clear any existing errors
        setError('');
        return;
      }
    } catch {
      // Not a JSON message, continue with normal processing
    }

    // For direct feedback calls (from the original chat button), use the old method
    if (!file || !documentation) return;
    
    try {
      // Read the file content
      const fileContent = await file.text();
      
      // Send feedback with current documentation for regeneration
      const response = await fetch('/api/agents/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pythonCode: fileContent,
          filename: file.name,
          currentDocumentation: documentation,
          userFeedback: feedback
        }),
      });

      if (response.ok) {
        const updatedDoc = await response.json();
        setDocumentation(updatedDoc);
        setSuccessMessage('Documentation updated based on your feedback!');
      } else {
        throw new Error('Failed to regenerate documentation');
      }
    } catch (error) {
      console.error('Feedback processing error:', error);
      setError('Failed to process feedback');
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 
      'text/x-python': ['.py'], 
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
    },
    multiple: true,
    onDrop: (acceptedFiles) => {
      const py = acceptedFiles.find((f) => f.name.endsWith('.py')) ?? null;
      const xl = acceptedFiles.find((f) => f.name.endsWith('.xlsx')) ?? null;
      const docx = acceptedFiles.find((f) => f.name.endsWith('.docx')) ?? null;
      if (py) setFile(py);
      if (xl) setExcelFile(xl);
      if (docx) setWordFile(docx);
    },
  });

  const generateDocumentation = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError('');
    setSuccessMessage('');
    setDocumentation(null);
    setProgressMessage('');

    try {
      const fileContent = await file.text();
      let excelCsv: string | null = null;
      if (excelFile) {
        const arrayBuffer = await excelFile.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        excelCsv = XLSX.utils.sheet_to_csv(wb.Sheets[firstSheet]);
      }
      
      // Extract sections from Word file if provided
      let existingDocxSections: ExtractedSections | null = null;
      if (wordFile) {
        const wordArrayBuffer = await wordFile.arrayBuffer();
        existingDocxSections = await extractSections(wordArrayBuffer);
      }
      
      // Step 1: Try streaming first (for faster models), fallback to background job for O3
      const response = await fetch('/api/openai-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pythonCode: fileContent,
          filename: file.name,
          existingExcel: excelCsv,
          existingDocxSections: existingDocxSections,
          useBackgroundJob: false,
        }),
      });

      if (!response.ok) {
        let errMsg = 'Failed to generate documentation';
        try {
          const errData = await response.json();
          errMsg = errData.error || errMsg;
        } catch {
          // ignore
        }
        throw new Error(errMsg);
      }

      // Check if response is streaming (SSE) or JSON
      const contentType = response.headers.get('Content-Type');
      if (contentType && contentType.includes('text/event-stream')) {
        // Handle streaming response (SSE)
        await handleStreamingResponse(response);
      } else {
        // Handle JSON response (background job)
        const responseData = await response.json();
        
        if (responseData.usePolling && responseData.jobId) {
          const documentationResult = await pollForJobCompletion(responseData.jobId);
          setDocumentation(documentationResult);
          setSuccessMessage(`Documentation generated successfully! You can view it below or download it as a DOCX file.`);
          
          // Note: Automatic KPI storage has been disabled. 
          // KPIs are only stored when user explicitly clicks "Store KPIs" button.
        } else {
          // This shouldn't happen with current implementation, but handle gracefully
          throw new Error('Unexpected response format: expected streaming or polling job');
        }
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
      setProgressMessage('');
    }
  };

  const pollForJobCompletion = async (jobId: string): Promise<Documentation> => {
    setProgressMessage('Job created, processing with O3 model...');
    
    const pollInterval = 2000; // Poll every 2 seconds
    const maxPollTime = 10 * 60 * 1000; // Maximum 10 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      try {
        const jobResponse = await fetch(`/api/jobs/${jobId}`);
        
        if (!jobResponse.ok) {
          throw new Error('Failed to check job status');
        }

        const job = await jobResponse.json();
        setProgressMessage(job.progress || 'Processing...');

        if (job.status === 'completed') {
          // Clean up job
          await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
          return job.result;
        }

        if (job.status === 'failed') {
          // Clean up job
          await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
          throw new Error(job.error || 'Job failed');
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (pollError) {
        console.error('Polling error:', pollError);
        // Continue polling unless it's a critical error
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error('Job timed out after 10 minutes');
  };

  const handleStreamingResponse = async (response: Response) => {
    // Handle Server-Sent Events stream using robust parser
    let documentationResult = null;
    let frameCount = 0;
    let errorCount = 0;

    try {
      for await (const data of decodeSSE(response)) {
        frameCount++;
        
        // Check if parsed data is valid
        if (data === undefined || data === null) {
          errorCount++;
          console.warn(`Received invalid SSE frame ${frameCount}: data is ${data}`);
          continue; // Continue processing instead of crashing
        }
        
        // Ensure data is an object
        if (typeof data !== 'object') {
          errorCount++;
          console.warn(`Received invalid SSE frame ${frameCount}: expected object, got ${typeof data}`);
          continue;
        }
        
        const msg = data as { error?: string; progress?: string; complete?: boolean; documentation?: Documentation };
        
        if (msg.error) {
          throw new Error(msg.error);
        }
        
        if (msg.progress) {
          setProgressMessage(msg.progress);
        }
        
        if (msg.complete && msg.documentation) {
          documentationResult = msg.documentation;
        }
      }
    } catch (parseError) {
      console.error('SSE parsing error:', parseError);
      // Provide more specific error message
      if (parseError instanceof Error) {
        throw new Error(`Failed to parse streaming response: ${parseError.message}`);
      } else {
        throw new Error('Failed to parse streaming response due to unknown error');
      }
    }

    // Log summary of parsing results
    if (errorCount > 0) {
      console.warn(`SSE parsing completed with ${errorCount} unparseable frames out of ${frameCount} total frames`);
    }

    if (!documentationResult) {
      throw new Error(`No documentation received from OpenAI (processed ${frameCount} frames, ${errorCount} errors)`);
    }
    setDocumentation(documentationResult);
    setSuccessMessage(`Documentation generated successfully! You can view it below or download it as a DOCX file.`);
    
    // Note: Automatic KPI storage has been disabled. 
    // KPIs are only stored when user explicitly clicks "Store KPIs" button.
  };

  const downloadDocumentation = async () => {
    if (!file || !documentation) return;

    setIsDownloading(true);
    setError('');
    
    try {
      // Step 2: Generate DOCX from existing documentation
      const response = await fetch('/api/generate-docs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentation: documentation,
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
              Upload your Python (.py) file to generate comprehensive documentation. 
              Excel (.xlsx) and Word (.docx) files are optional for additional context.
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
                      Drag & drop or click to browse • .py files required, .xlsx and .docx optional
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

            {/* Optional Files Section */}
            {(excelFile || wordFile) && (
              <div className="mt-6 space-y-4">
                <h3 className="font-semibold text-lg">Optional Files</h3>
                
                {/* Excel File Card */}
                {excelFile && (
                  <Card className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="rounded-full bg-green-100 p-2">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{excelFile.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Excel file for additional context • {(excelFile.size / 1024).toFixed(2)} KB
                          </p>
                        </div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setExcelFile(null)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                )}

                {/* Word File Card */}
                {wordFile && (
                  <Card className="p-4 border-blue-200 bg-blue-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="rounded-full bg-blue-100 p-2">
                          <CheckCircle className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{wordFile.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Word document for &quot;update existing document&quot; mode • {(wordFile.size / 1024).toFixed(2)} KB
                          </p>
                          <Badge variant="secondary" className="mt-1 text-xs">
                            Enables document update mode
                          </Badge>
                        </div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setWordFile(null)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* Generate Button */}
            <div className="mt-6 p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold mb-1">
                    {file ? 'Ready to Generate Documentation' : 'Python File Required'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {file 
                      ? 'Your file will be analyzed using AI to create comprehensive documentation'
                      : 'Please upload a Python (.py) file to get started. Excel and Word files are optional.'
                    }
                  </p>
                  {wordFile && (
                    <p className="text-sm text-blue-600 mt-1">
                      📝 Update mode enabled - will enhance existing Word document
                    </p>
                  )}
                </div>
                <Button
                  onClick={generateDocumentation}
                  disabled={!file || isProcessing}
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
                    {progressMessage || 'Analyzing code and generating documentation...'}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Documentation Viewer */}
        {documentation && file && (
          <DocumentationViewer 
            documentation={documentation} 
            onDownload={downloadDocumentation} 
            isDownloading={isDownloading}
            filename={file.name}
            onChatFeedback={handleChatFeedback}
            file={file}
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
