import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError, backoffDelay, withResilience } from '../resilience.js';

const noSleep = () => Promise.resolve();

describe('withResilience', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withResilience(fn, { name: 'test', sleep: noSleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries then succeeds, calling fn (retries + 1) times at most', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('recovered');
    const result = await withResilience(fn, { name: 'test', retries: 3, sleep: noSleep });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));
    await expect(withResilience(fn, { name: 'test', retries: 2, sleep: noSleep })).rejects.toThrow(
      'persistent',
    );
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      withResilience(fn, { name: 'test', retries: 5, sleep: noSleep, shouldRetry: () => false }),
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('short-circuits with CircuitOpenError when the breaker is open', async () => {
    const now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      clock: () => now,
    });
    breaker.recordFailure(); // trips open immediately at threshold 1
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(
      withResilience(fn, { name: 'dep', breaker, sleep: noSleep }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('CircuitBreaker', () => {
  it('opens after the failure threshold and rejects further requests', () => {
    const now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100, clock: () => now });
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('closed');
    cb.recordFailure();
    expect(cb.state).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('moves to half-open after the reset timeout, then closes on success', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100, clock: () => now });
    cb.recordFailure();
    expect(cb.state).toBe('open');
    now = 100;
    expect(cb.state).toBe('half-open');
    expect(cb.canRequest()).toBe(true);
    cb.recordSuccess();
    expect(cb.state).toBe('closed');
  });

  it('re-opens immediately when a half-open probe fails', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100, clock: () => now });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('open');
    now = 100;
    cb.canRequest(); // arms half-open
    cb.recordFailure(); // probe fails
    now = 150;
    expect(cb.state).toBe('open');
  });
});

describe('backoffDelay', () => {
  const opts = { baseDelayMs: 100, maxDelayMs: 5000, factor: 2 };

  it('grows exponentially without jitter', () => {
    expect(backoffDelay(0, opts, false, () => 0.5)).toBe(100);
    expect(backoffDelay(1, opts, false, () => 0.5)).toBe(200);
    expect(backoffDelay(2, opts, false, () => 0.5)).toBe(400);
  });

  it('caps at maxDelayMs', () => {
    expect(backoffDelay(10, opts, false, () => 0.5)).toBe(5000);
  });

  it('applies full jitter as a fraction of the raw delay', () => {
    expect(backoffDelay(1, opts, true, () => 0.5)).toBe(100); // 200 * 0.5
    expect(backoffDelay(1, opts, true, () => 0)).toBe(0);
  });
});
