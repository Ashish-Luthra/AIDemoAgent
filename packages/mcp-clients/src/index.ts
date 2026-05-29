/**
 * MCP connector wrappers (KICKOFF Week 3) — HubSpot, Salesforce, Confluence,
 * Google Drive. READ-ONLY this phase (CRM writeback is Phase 4). The base class
 * here enforces read-only + retry + circuit breaker + structured logs (lock);
 * concrete per-vendor connectors land in Week 3.
 */
export * from './base.js';

export const PACKAGE = '@allyvate/mcp-clients';
