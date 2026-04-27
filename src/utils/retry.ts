import * as core from '@actions/core';

export interface RetryOptions {
  attempts?: number;
  initialDelayMs?: number;
  label?: string;
  isRetriable?: (err: unknown) => boolean;
}

const defaultIsRetriable = (err: unknown): boolean => {
  const e = err as { status?: number; code?: string };
  if (typeof e?.status === 'number') {
    return e.status === 429 || (e.status >= 500 && e.status < 600);
  }
  if (e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT' || e?.code === 'ENOTFOUND' || e?.code === 'ECONNREFUSED') {
    return true;
  }
  return false;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const initialDelayMs = opts.initialDelayMs ?? 1000;
  const isRetriable = opts.isRetriable ?? defaultIsRetriable;
  const label = opts.label ?? 'operation';

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = i === attempts - 1;
      if (isLast || !isRetriable(err)) {
        throw err;
      }
      const delay = initialDelayMs * Math.pow(2, i);
      core.warning(`${label} failed on attempt ${i + 1}/${attempts}: ${err}; retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
