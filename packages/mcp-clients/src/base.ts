/**
 * Base MCP connector abstraction (KICKOFF Week 3 foundation).
 *
 * Phase 1 connectors are READ-ONLY — CRM writeback is Phase 4 (lock). This base
 * class enforces that boundary, funnels every call through the shared resilience
 * wrapper (retry + circuit breaker + structured logs — lock), and takes the MCP
 * transport by injection so connectors are unit-testable and the vendor SDK is a
 * one-place swap. Concrete per-vendor tool mappings (HubSpot, Salesforce,
 * Confluence, GDrive) land in Week 3 — those tool names are a vendor decision and
 * are deliberately not hardcoded here.
 */
import {
  CircuitBreaker,
  noopLogger,
  withResilience,
  type Logger,
  type ResilienceOptions,
} from '@allyvate/shared';

export type McpSource = 'hubspot' | 'salesforce' | 'confluence' | 'gdrive';

/** A document pulled from a source, normalized for the ingestion file-type router. */
export interface SourceDocument {
  source: McpSource;
  /** Stable id within the source system (page id, file id, record id). */
  externalId: string;
  /** Canonical URI for provenance backpointers. */
  uri: string;
  title: string;
  mimeType: string;
  /** Inline text content when the listing already provides it; else fetched lazily. */
  content?: string;
  /** ISO-8601 fetch timestamp (provenance.extractedAt). */
  fetchedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * The low-level MCP transport — the thing that actually speaks to an MCP server.
 * Injected so connectors stay testable and the concrete client is swappable.
 */
export interface McpTransport {
  callTool(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Thrown when a Phase-1 connector is asked to invoke a mutating MCP tool. */
export class ReadOnlyViolationError extends Error {
  constructor(source: McpSource, tool: string) {
    super(`${source} connector is read-only in Phase 1; refused tool "${tool}"`);
    this.name = 'ReadOnlyViolationError';
  }
}

/** Verbs that signal a tool mutates remote state — refused in Phase 1. */
const WRITE_VERBS = new Set([
  'create',
  'update',
  'delete',
  'write',
  'insert',
  'patch',
  'put',
  'post',
  'remove',
  'archive',
  'set',
]);

/** Splits a tool name into lowercase tokens, handling camelCase, snake_case, and dots. */
function tokenize(tool: string): string[] {
  return tool
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/** True if any token in the tool name is a write verb (`update_page`, `createDeal`). */
function isWriteTool(tool: string): boolean {
  return tokenize(tool).some((t) => WRITE_VERBS.has(t));
}

export interface ConnectorOptions {
  transport: McpTransport;
  logger?: Logger;
  /** Per-connector overrides for retry/backoff/breaker behavior. */
  resilience?: Partial<Omit<ResilienceOptions, 'name' | 'logger' | 'breaker'>>;
  /** Inject a shared breaker (e.g. one per remote host); defaults to a fresh one. */
  breaker?: CircuitBreaker;
}

export abstract class BaseMcpConnector {
  abstract readonly source: McpSource;
  readonly readOnly = true as const;

  protected readonly transport: McpTransport;
  protected readonly logger: Logger;
  private readonly breaker: CircuitBreaker;
  private readonly resilienceOverrides: Partial<
    Omit<ResilienceOptions, 'name' | 'logger' | 'breaker'>
  >;

  constructor(opts: ConnectorOptions) {
    this.transport = opts.transport;
    this.logger = (opts.logger ?? noopLogger).child({ component: 'mcp-connector' });
    this.breaker = opts.breaker ?? new CircuitBreaker();
    this.resilienceOverrides = opts.resilience ?? {};
  }

  /**
   * Read-only-guarded, resilience-wrapped MCP tool call. Refuses any tool that
   * looks like a mutation. All concrete connectors route reads through this.
   */
  protected async read<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    if (isWriteTool(tool)) {
      this.logger.error({ source: this.source, tool }, 'refused write tool on read-only connector');
      throw new ReadOnlyViolationError(this.source, tool);
    }
    return withResilience(() => this.transport.callTool(tool, args) as Promise<T>, {
      name: `${this.source}.${tool}`,
      logger: this.logger,
      breaker: this.breaker,
      ...this.resilienceOverrides,
    });
  }

  /** Lists the documents this source exposes for ingestion. */
  abstract listDocuments(): Promise<SourceDocument[]>;

  /** Fetches one document's full content by its source-local id. */
  abstract fetchDocument(externalId: string): Promise<SourceDocument>;
}
