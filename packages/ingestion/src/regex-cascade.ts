import type { EdgeType } from '@allyvate/shared';

/**
 * Deterministic regex edge-inference cascade (KICKOFF lock #3) — types the
 * obvious edges with ZERO LLM calls. Claude is reserved for the ambiguous
 * remainder only. This is the seed of the Week-3 rule set; rules will move to
 * `rules/` and grow per the sales-content domain.
 */
export interface InferredEdge {
  type: EdgeType;
  /** Canonical name (or raw mention) of the edge target. */
  target: string;
  method: 'regex';
}

interface Rule {
  type: EdgeType;
  pattern: RegExp;
}

/**
 * A product/entity mention: a sequence of Capitalized words (allowing internal
 * `.`, `&`, `-` for names like "Node.js" or "AT&T"). Matching only Capitalized
 * tokens stops the capture at lowercase filler — "integrates with Salesforce
 * out of the box" yields "Salesforce", not the rest of the sentence.
 */
const ENTITY = String.raw`[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*)*`;

// NOTE: the entity-capturing rules are deliberately NOT case-insensitive — a
// global `i` flag would make `[A-Z]` in ENTITY match lowercase too, swallowing
// filler words after the real entity. Only the keyword verb's first letter is
// allowed to vary (sentence-initial capitalization).
const RULES: Rule[] = [
  // "integrates with X", "integration with X"
  {
    type: 'INTEGRATES_WITH',
    pattern: new RegExp(String.raw`\b[Ii]ntegrat(?:es?|ion)\s+with\s+(${ENTITY})`, 'g'),
  },
  // "uses X", "built on X", "powered by X"
  {
    type: 'USES',
    pattern: new RegExp(String.raw`\b(?:[Uu]ses?|[Bb]uilt on|[Pp]owered by)\s+(${ENTITY})`, 'g'),
  },
  // "for <persona>", "for sales teams", "designed for marketers"
  {
    type: 'FOR_PERSONA',
    pattern: /\b(?:for|designed for|built for)\s+([a-z]+(?:\s+(?:teams?|leaders?|managers?))?)\b/gi,
  },
];

export function inferEdgesFromText(text: string): InferredEdge[] {
  const edges: InferredEdge[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      // Strip trailing punctuation a Capitalized token may carry ("Salesforce.").
      const target = match[1]?.trim().replace(/[.,;:!?]+$/, '');
      if (target) edges.push({ type: rule.type, target, method: 'regex' });
    }
  }
  return edges;
}
