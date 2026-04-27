import { withRetry } from '../../src/utils/retry';

describe('withRetry', () => {
  it('returns the result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient 5xx and eventually succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { initialDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 (rate limit)', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('limit'), { status: 429 }))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { initialDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx other than 429', async () => {
    const err = Object.assign(new Error('bad'), { status: 400 });
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { initialDelayMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after max attempts and rethrows the last error', async () => {
    const err = Object.assign(new Error('boom'), { status: 500 });
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { attempts: 3, initialDelayMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on common network error codes', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { initialDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
