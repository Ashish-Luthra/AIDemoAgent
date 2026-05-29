/**
 * Entity resolution — cross-source canonical-node merge (KICKOFF Week 2).
 *
 * This is the DETERMINISTIC pass: it merges surface variants of the same name
 * ("Match Booster", "MatchBooster™", "match booster.", "Match  Booster") onto one
 * canonical node with zero LLM calls — the regex-first spirit of lock #3. Genuine
 * SEMANTIC merges ("Match Booster" ≡ "identity resolution") are not surface
 * variants and stay the Claude classifier's job; this pass intentionally does not
 * attempt them (it would produce false merges).
 */

/** A node the resolver can match against — canonical name plus known aliases. */
export interface ResolvableNode {
  id: string;
  canonicalName: string;
  aliases: string[];
}

export interface ResolutionResult {
  /** Existing node this mention resolved to, or null if it is new. */
  matchedNodeId: string | null;
  /** The canonical name to use (existing node's, or the original mention if new). */
  canonicalName: string;
  /** Normalized comparison key. */
  normalized: string;
  isNew: boolean;
}

/**
 * Normalizes a name to a comparison key: strips trademark/registered symbols,
 * lowercases, removes punctuation, and collapses whitespace. Two names sharing a
 * key are treated as the same surface entity.
 */
export function normalizeEntityName(name: string): string {
  return (
    name
      // Strip trademark/registered symbols BEFORE NFKC — NFKC expands ™→"TM", ℠→"SM".
      .replace(/[™®©℠]/g, '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

/** Builds a normalized-key → nodeId index from a node's canonical name and aliases. */
function indexNode(node: ResolvableNode, into: Map<string, string>): void {
  for (const name of [node.canonicalName, ...node.aliases]) {
    const key = normalizeEntityName(name);
    if (key && !into.has(key)) into.set(key, node.id);
  }
}

/** Resolves a single mention against existing nodes by normalized surface match. */
export function resolveEntity(mention: string, existing: ResolvableNode[]): ResolutionResult {
  const index = new Map<string, string>();
  for (const node of existing) indexNode(node, index);
  return resolveAgainstIndex(mention, index, existing);
}

function resolveAgainstIndex(
  mention: string,
  index: Map<string, string>,
  nodes: ResolvableNode[],
): ResolutionResult {
  const normalized = normalizeEntityName(mention);
  const matchedNodeId = normalized ? (index.get(normalized) ?? null) : null;
  const canonicalName =
    matchedNodeId !== null
      ? (nodes.find((n) => n.id === matchedNodeId)?.canonicalName ?? mention.trim())
      : mention.trim();
  return { matchedNodeId, canonicalName, normalized, isNew: matchedNodeId === null };
}

export interface BatchResolution {
  /** One result per input mention, in order. */
  results: ResolutionResult[];
  /**
   * Distinct new canonical entities discovered in this batch (deduped among
   * themselves). Each carries the variant spellings seen, as proposed aliases.
   */
  newEntities: { canonicalName: string; normalized: string; aliases: string[] }[];
}

/**
 * Resolves a batch of mentions against existing nodes, also deduplicating new
 * mentions against each other so two spellings of the same new entity in one
 * batch collapse to a single new canonical node.
 */
export function resolveEntities(mentions: string[], existing: ResolvableNode[]): BatchResolution {
  const index = new Map<string, string>();
  for (const node of existing) indexNode(node, index);

  const results: ResolutionResult[] = [];
  const newByKey = new Map<
    string,
    { canonicalName: string; normalized: string; aliases: string[] }
  >();

  for (const mention of mentions) {
    const normalized = normalizeEntityName(mention);
    const trimmed = mention.trim();

    if (!normalized) {
      results.push({ matchedNodeId: null, canonicalName: trimmed, normalized, isNew: true });
      continue;
    }

    const existingId = index.get(normalized);
    if (existingId) {
      const node = existing.find((n) => n.id === existingId);
      results.push({
        matchedNodeId: existingId,
        canonicalName: node?.canonicalName ?? trimmed,
        normalized,
        isNew: false,
      });
      continue;
    }

    // New to the existing graph — fold into this batch's new entities.
    const seen = newByKey.get(normalized);
    if (seen) {
      if (trimmed && !seen.aliases.includes(trimmed)) seen.aliases.push(trimmed);
      results.push({
        matchedNodeId: null,
        canonicalName: seen.canonicalName,
        normalized,
        isNew: true,
      });
    } else {
      newByKey.set(normalized, { canonicalName: trimmed, normalized, aliases: [trimmed] });
      results.push({ matchedNodeId: null, canonicalName: trimmed, normalized, isNew: true });
    }
  }

  return { results, newEntities: [...newByKey.values()] };
}
