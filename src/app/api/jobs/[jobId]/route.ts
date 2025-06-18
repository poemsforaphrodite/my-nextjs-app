import { NextRequest, NextResponse } from 'next/server';

// In-memory job store (in production, use Redis or database)
const jobs = new Map<string, {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: string;
  result?: any;
  error?: string;
  createdAt: Date;
}>();

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const job = jobs.get(params.jobId);
  
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  
  return NextResponse.json(job);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  jobs.delete(params.jobId);
  return NextResponse.json({ success: true });
}

// Helper function to store job
export function createJob(id: string) {
  const job = {
    id,
    status: 'pending' as const,
    progress: 'Job created',
    createdAt: new Date()
  };
  jobs.set(id, job);
  return job;
}

// Helper function to update job
export function updateJob(id: string, updates: Partial<typeof jobs extends Map<string, infer T> ? T : never>) {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, updates);
    jobs.set(id, job);
  }
}