import { describe, expect, it } from 'vitest';
import type { RetrievalQuery } from '@allyvate/shared';
import {
  runRetrieval,
  type ArtifactFeatures,
  type CandidateArm,
  type FeatureSource,
  type Reranker,
} from '../rie.js';

const TENANT = '00000000-0000-0000-0000-000000000000';
const query = (over: Partial<RetrievalQuery> = {}): RetrievalQuery => ({
  tenantId: TENANT,
  question: 'How do you handle the pricing objection?',
  ...over,
});

/** A fixed-result arm for Stage 1. */
function arm(name: string, ids: string[]): CandidateArm {
  return { name, search: async () => ({ ids }) };
}

function feature(id: string, over: Partial<ArtifactFeatures> = {}): ArtifactFeatures {
  return {
    artifactId: id,
    subtype: 'ObjectionHandler',
    title: `Artifact ${id}`,
    personaTags: [],
    objectionTags: [],
    historicalSuccess: 0,
    opportunityStageFit: 0,
    freshness: 0,
    approval: 0,
    ...over,
  };
}

function featureSource(features: ArtifactFeatures[]): FeatureSource {
  const map = new Map(features.map((f) => [f.artifactId, f]));
  return {
    features: async (_tenant, ids) =>
      new Map(ids.filter((id) => map.has(id)).map((id) => [id, map.get(id)!])),
  };
}

describe('runRetrieval', () => {
  it('returns an empty result when no candidates are generated', async () => {
    const result = await runRetrieval(query(), {
      arms: [arm('vector', [])],
      features: featureSource([]),
    });
    expect(result.topArtifactId).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.alternatives).toEqual([]);
  });

  it('fuses arms, scores, and selects the top artifact with a reasoning trace', async () => {
    const deps = {
      arms: [arm('vector', ['a', 'b']), arm('keyword', ['b', 'a'])],
      features: featureSource([
        // 'b' wins on historical success + approval despite similar hybrid rank.
        feature('a', { historicalSuccess: 0.1, approval: 0.2 }),
        feature('b', { historicalSuccess: 1, approval: 1, freshness: 1 }),
      ]),
    };
    const result = await runRetrieval(query(), deps);
    expect(result.topArtifactId).toBe('b');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reasoningTrace).toContain('Artifact b');
    expect(result.alternatives.map((c) => c.artifactId)).toEqual(['a']);
  });

  it('rewards a persona-hint match through the persona input', async () => {
    const deps = {
      arms: [arm('vector', ['a', 'b'])],
      features: featureSource([
        feature('a', { personaTags: ['CFO'] }),
        feature('b', { personaTags: ['Engineer'] }),
      ]),
    };
    const result = await runRetrieval(query({ personaHint: 'CFO' }), deps);
    expect(result.topArtifactId).toBe('a');
  });

  it('applies the reranker when provided', async () => {
    const reranker: Reranker = {
      rerank: async (_q, ids) =>
        // Force 'b' to the top regardless of fusion order.
        ids
          .map((id) => ({ id, relevanceScore: id === 'b' ? 1 : 0.1 }))
          .sort((x, y) => y.relevanceScore - x.relevanceScore),
    };
    const result = await runRetrieval(query(), {
      arms: [arm('vector', ['a', 'b', 'c'])],
      features: featureSource([feature('a'), feature('b'), feature('c')]),
      reranker,
    });
    expect(result.topArtifactId).toBe('b');
  });

  it('supports graph-on vs graph-off (the graph arm can be excluded)', async () => {
    const arms = [arm('vector', ['a']), arm('graph', ['z'])];
    const features = featureSource([feature('a'), feature('z', { historicalSuccess: 1 })]);
    const allIds = (r: { topArtifactId: string | null; alternatives: { artifactId: string }[] }) =>
      [r.topArtifactId, ...r.alternatives.map((c) => c.artifactId)].filter(Boolean);

    const on = await runRetrieval(query(), { arms, features, graphEnabled: true });
    const off = await runRetrieval(query(), { arms, features, graphEnabled: false });

    // The graph arm surfaces 'z' (which wins on historical success); off, only 'a' survives.
    expect(allIds(on)).toContain('z');
    expect(allIds(off)).not.toContain('z');
    expect(off.topArtifactId).toBe('a');
    expect(off.alternatives).toEqual([]);
  });
});
