import { describe, expect, it } from 'vitest';
import {
  normalizeEntityName,
  resolveEntities,
  resolveEntity,
  type ResolvableNode,
} from '../entity-resolution.js';

const NODES: ResolvableNode[] = [
  { id: 'n1', canonicalName: 'Match Booster', aliases: ['MatchBooster'] },
  { id: 'n2', canonicalName: 'Salesforce', aliases: [] },
];

describe('normalizeEntityName', () => {
  it('strips trademark symbols, punctuation, case, and extra whitespace', () => {
    expect(normalizeEntityName('MatchBooster™')).toBe('matchbooster');
    expect(normalizeEntityName('Match  Booster.')).toBe('match booster');
    expect(normalizeEntityName('Match Booster')).toBe('match booster');
  });
});

describe('resolveEntity', () => {
  it('matches a surface variant onto the existing canonical node', () => {
    const r = resolveEntity('match booster.', NODES);
    expect(r.matchedNodeId).toBe('n1');
    expect(r.canonicalName).toBe('Match Booster');
    expect(r.isNew).toBe(false);
  });

  it('matches via an alias', () => {
    const r = resolveEntity('MatchBooster™', NODES);
    expect(r.matchedNodeId).toBe('n1');
  });

  it('returns isNew for an unknown entity', () => {
    const r = resolveEntity('HubSpot', NODES);
    expect(r.matchedNodeId).toBeNull();
    expect(r.isNew).toBe(true);
    expect(r.canonicalName).toBe('HubSpot');
  });

  it('does not semantically merge distinct names', () => {
    // "identity resolution" is a semantic synonym, NOT a surface variant — the
    // deterministic pass must leave it for the Claude classifier.
    const r = resolveEntity('identity resolution', NODES);
    expect(r.isNew).toBe(true);
  });
});

describe('resolveEntities (batch)', () => {
  it('collapses surface variants of a new entity within one batch', () => {
    const { results, newEntities } = resolveEntities(['Acme CRM', 'acme crm', 'AcmeCRM™'], NODES);
    expect(results.every((r) => r.isNew)).toBe(true);
    // All three normalize differently? "Acme CRM" -> "acme crm", "AcmeCRM" -> "acmecrm".
    // First two share a key; the third differs. So two distinct new entities.
    const keys = new Set(newEntities.map((e) => e.normalized));
    expect(keys.has('acme crm')).toBe(true);
    const acmeCrm = newEntities.find((e) => e.normalized === 'acme crm')!;
    expect(acmeCrm.aliases).toContain('Acme CRM');
    expect(acmeCrm.aliases).toContain('acme crm');
  });

  it('resolves known and unknown mentions in a single pass', () => {
    const { results } = resolveEntities(['Salesforce', 'Brand New Co'], NODES);
    expect(results[0]!.matchedNodeId).toBe('n2');
    expect(results[1]!.isNew).toBe(true);
  });
});
