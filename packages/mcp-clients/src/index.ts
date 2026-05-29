/**
 * MCP connector wrappers (KICKOFF Week 3) — HubSpot, Salesforce, Confluence,
 * Google Drive. READ-ONLY this phase (CRM writeback is Phase 4). Each wrapper is
 * a typed interface with retry + circuit breaker + structured logs (lock).
 */
export type McpSource = 'hubspot' | 'salesforce' | 'confluence' | 'gdrive';

export interface McpConnector {
  readonly source: McpSource;
  readonly readOnly: true;
}

export const PACKAGE = '@allyvate/mcp-clients';
