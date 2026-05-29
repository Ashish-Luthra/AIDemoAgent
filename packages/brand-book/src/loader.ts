/**
 * Brand Book loader + compiler (KICKOFF lock #5: markdown is the system of
 * record). A Brand Book is a per-tenant markdown "constitution" — voice, banned
 * words, compliance rules, positioning. This module parses that markdown into a
 * structured shape and compiles a compact snippet for injection into the Claude
 * classifier and retrieval-time policy.
 *
 * Dependency-free: section parsing keys off `##` headings, so no markdown
 * library is pulled in. The markdown stays authoritative; this struct is derived.
 */

/** Canonical sections every Brand Book may declare. All optional but `voice`. */
export interface BrandBook {
  tenantId: string;
  version: number;
  /** Tone/voice guidance, free text. */
  voice: string;
  /** Words/phrases the agent must never use (compliance + brand). */
  bannedWords: string[];
  /** Compliance and legal constraints, free text. */
  compliance: string;
  /** Market positioning and competitive framing, free text. */
  positioning: string;
  /** The source markdown — authoritative; everything above is derived from it. */
  raw: string;
}

/** Heading text → BrandBook field. Matched case-insensitively, trimmed. */
const SECTION_ALIASES: Record<string, 'voice' | 'bannedWords' | 'compliance' | 'positioning'> = {
  voice: 'voice',
  'voice & tone': 'voice',
  tone: 'voice',
  'banned words': 'bannedWords',
  'banned terms': 'bannedWords',
  'do not use': 'bannedWords',
  compliance: 'compliance',
  legal: 'compliance',
  positioning: 'positioning',
  'market positioning': 'positioning',
};

interface ParsedSection {
  title: string;
  body: string;
}

/** Splits markdown into `##`-delimited sections. Content before the first `##` is ignored. */
function splitSections(markdown: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = markdown.split('\n');
  let current: ParsedSection | null = null;
  for (const line of lines) {
    const heading = /^##\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1]!.trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Parses a banned-words section. Accepts a bulleted list (`- term`), a numbered
 * list, or a single comma-separated line. Case and surrounding markup stripped.
 */
function parseBannedWords(body: string): string[] {
  const words: string[] = [];
  const lines = body.split('\n').map((l) => l.trim());
  const listItems = lines.filter((l) => /^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l));
  if (listItems.length > 0) {
    for (const item of listItems) {
      const term = item
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/[`"*]/g, '')
        .trim();
      if (term) words.push(term);
    }
  } else {
    // Fall back to comma-separated terms on the non-empty lines.
    for (const line of lines.filter(Boolean)) {
      for (const term of line.split(',')) {
        const t = term.replace(/[`"*]/g, '').trim();
        if (t) words.push(t);
      }
    }
  }
  // De-dupe case-insensitively, preserving first-seen casing.
  const seen = new Set<string>();
  return words.filter((w) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface BrandBookMeta {
  tenantId: string;
  version?: number;
}

/** Parses Brand Book markdown into the structured, derived shape. */
export function parseBrandBook(markdown: string, meta: BrandBookMeta): BrandBook {
  const book: BrandBook = {
    tenantId: meta.tenantId,
    version: meta.version ?? 1,
    voice: '',
    bannedWords: [],
    compliance: '',
    positioning: '',
    raw: markdown,
  };

  for (const section of splitSections(markdown)) {
    const field = SECTION_ALIASES[section.title.toLowerCase()];
    if (!field) continue;
    const body = section.body.trim();
    if (field === 'bannedWords') {
      book.bannedWords = parseBannedWords(section.body);
    } else {
      book[field] = body;
    }
  }

  return book;
}

/**
 * Compiles the Brand Book into a compact system-prompt snippet. Small by design
 * (PRD: "small enough to load into context") — injected into the classifier and
 * retrieval-time policy.
 */
export function compileForContext(book: BrandBook): string {
  const parts: string[] = ['# Brand Book'];
  if (book.voice) parts.push(`## Voice\n${book.voice}`);
  if (book.positioning) parts.push(`## Positioning\n${book.positioning}`);
  if (book.compliance) parts.push(`## Compliance\n${book.compliance}`);
  if (book.bannedWords.length > 0) {
    parts.push(`## Never use these terms\n${book.bannedWords.map((w) => `- ${w}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** A banned-word match found in candidate text, with its character offset. */
export interface BannedWordHit {
  word: string;
  index: number;
}

/**
 * Scans `text` for any banned word (whole-word, case-insensitive). Used by the
 * compliance pass before retrieval surfaces an artifact.
 */
export function findBannedWords(text: string, book: BrandBook): BannedWordHit[] {
  const hits: BannedWordHit[] = [];
  for (const word of book.bannedWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');
    for (const match of text.matchAll(pattern)) {
      hits.push({ word, index: match.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}
