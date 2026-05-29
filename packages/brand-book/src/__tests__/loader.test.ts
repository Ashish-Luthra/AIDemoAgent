import { describe, expect, it } from 'vitest';
import { compileForContext, findBannedWords, parseBrandBook } from '../loader.js';

const SAMPLE = `# Allyvate Brand Book

Intro prose before the first section is ignored.

## Voice
Confident, concise, and helpful. Never salesy.

## Banned Words
- guarantee
- cheap
- \`synergy\`

## Compliance
Never make unverified ROI claims.

## Positioning
The Brand Brain behind two interfaces.

## Unknown Section
This should be ignored by the parser.
`;

describe('parseBrandBook', () => {
  it('extracts each known section into its field', () => {
    const book = parseBrandBook(SAMPLE, { tenantId: 't1', version: 3 });
    expect(book.tenantId).toBe('t1');
    expect(book.version).toBe(3);
    expect(book.voice).toBe('Confident, concise, and helpful. Never salesy.');
    expect(book.compliance).toBe('Never make unverified ROI claims.');
    expect(book.positioning).toBe('The Brand Brain behind two interfaces.');
  });

  it('parses banned words from a bulleted list, stripping markup', () => {
    const book = parseBrandBook(SAMPLE, { tenantId: 't1' });
    expect(book.bannedWords).toEqual(['guarantee', 'cheap', 'synergy']);
  });

  it('defaults version to 1 and keeps the raw markdown authoritative', () => {
    const book = parseBrandBook(SAMPLE, { tenantId: 't1' });
    expect(book.version).toBe(1);
    expect(book.raw).toBe(SAMPLE);
  });

  it('parses comma-separated banned words when no list is present', () => {
    const md = '## Banned Words\nguarantee, cheap, world-class\n';
    const book = parseBrandBook(md, { tenantId: 't1' });
    expect(book.bannedWords).toEqual(['guarantee', 'cheap', 'world-class']);
  });

  it('de-dupes banned words case-insensitively', () => {
    const md = '## Banned Words\n- Cheap\n- cheap\n- CHEAP\n';
    const book = parseBrandBook(md, { tenantId: 't1' });
    expect(book.bannedWords).toEqual(['Cheap']);
  });

  it('recognizes heading aliases case-insensitively', () => {
    const md = '## Voice & Tone\nWarm.\n\n## Do Not Use\n- foo\n';
    const book = parseBrandBook(md, { tenantId: 't1' });
    expect(book.voice).toBe('Warm.');
    expect(book.bannedWords).toEqual(['foo']);
  });
});

describe('compileForContext', () => {
  it('produces a compact snippet omitting empty sections', () => {
    const book = parseBrandBook('## Voice\nConcise.\n', { tenantId: 't1' });
    const snippet = compileForContext(book);
    expect(snippet).toContain('# Brand Book');
    expect(snippet).toContain('## Voice\nConcise.');
    expect(snippet).not.toContain('Positioning');
    expect(snippet).not.toContain('Never use these terms');
  });

  it('renders banned words as a list', () => {
    const book = parseBrandBook('## Banned Words\n- guarantee\n', { tenantId: 't1' });
    expect(compileForContext(book)).toContain('## Never use these terms\n- guarantee');
  });
});

describe('findBannedWords', () => {
  it('finds whole-word, case-insensitive matches with offsets', () => {
    const book = parseBrandBook('## Banned Words\n- guarantee\n- cheap\n', { tenantId: 't1' });
    const hits = findBannedWords('We Guarantee results, not a cheap fix.', book);
    expect(hits.map((h) => h.word)).toEqual(['guarantee', 'cheap']);
    expect(hits[0]!.index).toBe(3);
  });

  it('does not match substrings inside larger words', () => {
    const book = parseBrandBook('## Banned Words\n- cheap\n', { tenantId: 't1' });
    expect(findBannedWords('cheapskate', book)).toEqual([]);
  });
});
