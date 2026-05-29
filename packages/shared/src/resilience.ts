/**
 * Cross-cutting resilience + logging primitives.
 *
 * KICKOFF lock: "Every external API call goes through a typed wrapper with
 * retry + circuit breaker + structured logs." This module is that wrapper's
 * engine — every provider implementation and MCP connector calls
 * `withResilience` rather than rolling its own retry loop.
 *
 * Dependency-free on purpose: `shared` stays at zod-only. Apps inject a real
 * Pino instance through the `Logger` interface; packages never import Pino.
 */

// ── Structured logging contract ──────────────────────────────────────────────

/**
 * Pino-compatible structured logger. The first arg is a bindings object (so logs
 * stay queryable in CloudWatch/DataDog), the second an optional human message.
 */
export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  /** Returns a logger that merges `bindings` into every record. */
  child(bindings: Record<string, unknown>): Logger;
}

/** Minimal console-backed logger — the default when no Pino instance is wired. */
export function createConsoleLogger(base: Record<string, unknown> = {}): Logger {
  const emit =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (obj: Record<string, unknown>, msg?: string): void => {
      const record = { level, ...base, ...obj, ...(msg ? { msg } : {}) };
      console[level === 'debug' ? 'log' : level](JSON.stringify(record));
    };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (bindings) => createConsoleLogger({ ...base, ...bindings }),
  };
}

/** A logger that drops everything — convenient default for library internals. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

// ── Circuit breaker ──────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit trips open. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before allowing a half-open probe (ms). Default 30_000. */
  resetTimeoutMs?: number;
  /** Injectable clock for deterministic tests. Default `Date.now`. */
  clock?: () => number;
}

/** Thrown by `withResilience` when the breaker is open and refuses the call. */
export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit "${name}" is open`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * A standard three-state breaker. `closed` lets calls through; `open` rejects
 * fast; after `resetTimeoutMs` it goes `half-open` and lets a single probe
 * through — success closes it, failure re-opens it.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly clock: () => number;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpen = false;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.clock = opts.clock ?? Date.now;
  }

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    if (this.clock() - this.openedAt >= this.resetTimeoutMs) return 'half-open';
    return 'open';
  }

  /** Whether a call may proceed right now. Transitions open → half-open lazily. */
  canRequest(): boolean {
    const state = this.state;
    if (state === 'open') return false;
    if (state === 'half-open') this.halfOpen = true;
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.halfOpen = false;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    // A failed half-open probe immediately re-opens the circuit.
    if (this.halfOpen || this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.clock();
      this.halfOpen = false;
    }
  }
}

// ── Retry + circuit breaker wrapper ──────────────────────────────────────────

export interface RetryOptions {
  /** Retry attempts after the first try. Default 3 (so up to 4 calls). */
  retries?: number;
  /** First backoff delay (ms). Default 200. */
  baseDelayMs?: number;
  /** Backoff ceiling (ms). Default 5_000. */
  maxDelayMs?: number;
  /** Exponential growth factor. Default 2. */
  factor?: number;
  /** Apply full jitter to each delay. Default true. */
  jitter?: boolean;
  /** Decide whether a given error is retryable. Default: always retry. */
  shouldRetry?: (error: unknown) => boolean;
  /** Injectable sleep — tests pass a no-op to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable RNG for deterministic jitter in tests. Default `Math.random`. */
  random?: () => number;
}

export interface ResilienceOptions extends RetryOptions {
  /** Identifies the call in logs and circuit errors (e.g. "hubspot.listDeals"). */
  name: string;
  logger?: Logger;
  /** Shared breaker — pass the same instance across calls to one dependency. */
  breaker?: CircuitBreaker;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Computes the backoff delay for a given attempt (0-indexed), with optional jitter. */
export function backoffDelay(
  attempt: number,
  opts: Required<Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'factor'>>,
  jitter: boolean,
  random: () => number,
): number {
  const raw = Math.min(opts.maxDelayMs, opts.baseDelayMs * opts.factor ** attempt);
  return jitter ? Math.round(raw * random()) : raw;
}

/**
 * Runs `fn` with exponential-backoff retry behind an optional circuit breaker,
 * emitting structured logs on every retry and on terminal failure. This is the
 * single chokepoint every external call funnels through.
 */
export async function withResilience<T>(fn: () => Promise<T>, opts: ResilienceOptions): Promise<T> {
  const {
    name,
    logger = noopLogger,
    breaker,
    retries = 3,
    baseDelayMs = 200,
    maxDelayMs = 5_000,
    factor = 2,
    jitter = true,
    shouldRetry = () => true,
    sleep = defaultSleep,
    random = Math.random,
  } = opts;

  if (breaker && !breaker.canRequest()) {
    logger.warn({ call: name, circuit: breaker.state }, 'circuit open — short-circuiting');
    throw new CircuitOpenError(name);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await fn();
      breaker?.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      breaker?.recordFailure();
      const retryable = attempt < retries && shouldRetry(error);
      if (!retryable) {
        logger.error({ call: name, attempt, err: errInfo(error) }, 'call failed (terminal)');
        throw error;
      }
      const delay = backoffDelay(attempt, { baseDelayMs, maxDelayMs, factor }, jitter, random);
      logger.warn(
        { call: name, attempt, delayMs: delay, err: errInfo(error) },
        'call failed — retrying',
      );
      await sleep(delay);
    }
  }
  // Unreachable: the loop either returns or throws, but satisfies the type checker.
  throw lastError;
}

function errInfo(error: unknown): { message: string; name?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}
