export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  status: JobStatus;
  progress: string;
  result?: unknown;
  error?: string;
  createdAt: Date;
}

// Simple in-memory store. Replace with persistent store in production.
const jobs = new Map<string, Job>();

export function createJob(id: string, initialProgress = 'Job created'): Job {
  const job: Job = {
    id,
    status: 'pending',
    progress: initialProgress,
    createdAt: new Date(),
  };
  jobs.set(id, job);
  return job;
}

export function updateJob(id: string, updates: Partial<Job>): void {
  const existing = jobs.get(id);
  if (existing) {
    Object.assign(existing, updates);
    jobs.set(id, existing);
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function deleteJob(id: string): void {
  jobs.delete(id);
} 