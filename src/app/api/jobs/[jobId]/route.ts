/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';
import { getJob, deleteJob as removeJob } from '@/lib/job-store';

export async function GET(request: NextRequest, context: any) {
  const job = getJob(context.params.jobId);
  
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  
  return NextResponse.json(job);
}

export async function DELETE(request: NextRequest, context: any) {
  removeJob(context.params.jobId);
  return NextResponse.json({ success: true });
}