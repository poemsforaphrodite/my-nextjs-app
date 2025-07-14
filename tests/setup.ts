import { vi } from 'vitest';

// Load environment variables for testing
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env.test' });
} catch (e) {
  console.log('dotenv not available, using process.env directly');
}

// Mock environment variables if not present
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = 'test-openai-key';
}

if (!process.env.PINECONE_API_KEY) {
  process.env.PINECONE_API_KEY = 'test-pinecone-key';
}

if (!process.env.OPENAI_MODEL) {
  process.env.OPENAI_MODEL = 'gpt-4o-mini';
}

// Global test configuration
global.fetch = vi.fn();

// Mock console methods to reduce noise during tests
const originalConsoleError = console.error;
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

console.error = vi.fn();
console.log = vi.fn();
console.warn = vi.fn();

// Restore console methods for specific tests if needed
export function enableConsoleLogs() {
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
}

export function disableConsoleLogs() {
  console.error = vi.fn();
  console.log = vi.fn();
  console.warn = vi.fn();
}