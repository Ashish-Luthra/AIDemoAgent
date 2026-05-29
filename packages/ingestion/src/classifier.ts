/**
 * Claude ingestion classifier (KICKOFF lock #3: "Claude for the ambiguous
 * remainder"). The deterministic regex cascade (regex-cascade.ts) types the
 * obvious edges with zero LLM calls; this module reserves Claude for the harder
 * work — typed Knowledge Object classification, summary/tag extraction, and the
 * ambiguous semantic edges regex can't type.
 *
 * Every Claude call uses structured output validated by a Zod schema, with NO
 * free-form parsing (KICKOFF convention). The provider returns a candidate
 * object; we validate it against `ClassifierOutput` and, on a schema miss, re-ask
 * once with the validation errors fed back before giving up.
 */
import { ClassifierOutput, KO_SUBTYPES, noopLogger, type Logger } from '@allyvate/shared';
import type { LlmProvider } from '@allyvate/shared/providers';

export interface ClassifyArgs {
  /** Extracted document text (post-LlamaParse / post-Whisper). */
  text: string;
  /** The LLM provider abstraction (Anthropic Claude in prod, fake in tests). */
  llm: LlmProvider;
  /** Source label for prompt context (e.g. "gdrive", "confluence"). */
  source?: string;
  /** Compiled Brand Book snippet to load into context (voice/compliance/positioning). */
  brandBookContext?: string;
  /** Optional title hint from the source listing. */
  title?: string;
  /** Total classification attempts before failing. Default 2 (1 retry on schema miss). */
  maxAttempts?: number;
  /** Per-call token ceiling passed to the provider. */
  maxTokens?: number;
  logger?: Logger;
}

/** Thrown when the model cannot produce a schema-valid classification in time. */
export class ClassificationError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastIssue?: string,
  ) {
    super(message);
    this.name = 'ClassificationError';
  }
}

const SYSTEM_PROMPT = [
  'You are the ingestion classifier for a B2B sales knowledge base.',
  'Classify the document into exactly one Knowledge Object subtype from this set:',
  KO_SUBTYPES.join(', ') + '.',
  '',
  'Also extract a short title, a one-paragraph summary, persona tags (buyer roles',
  'the content speaks to), and objection tags (sales objections it addresses).',
  '',
  'For relationships that a simple keyword rule could NOT determine — i.e. ambiguous',
  'or semantic edges — propose them in `inferredEdges`, each with a confidence in',
  '[0,1]. Do NOT emit obvious "integrates with X" / "uses X" edges; those are handled',
  'deterministically upstream.',
  '',
  'Respond ONLY with an object matching the required schema. No prose.',
].join('\n');

function buildPrompt(args: ClassifyArgs, priorIssue?: string): string {
  const parts: string[] = [];
  if (args.brandBookContext) {
    parts.push('Brand Book (authoritative voice/compliance/positioning):');
    parts.push(args.brandBookContext, '');
  }
  if (args.source) parts.push(`Source system: ${args.source}`);
  if (args.title) parts.push(`Source-provided title: ${args.title}`);
  parts.push('', 'Document:', '"""', args.text, '"""');
  if (priorIssue) {
    parts.push(
      '',
      'Your previous response failed schema validation with these issues:',
      priorIssue,
      'Return a corrected object that satisfies the schema exactly.',
    );
  }
  return parts.join('\n');
}

/**
 * Classifies one extracted document into a validated `ClassifierOutput`.
 * Retries once (by default) when the model's object fails Zod validation,
 * feeding the validation issues back into the prompt.
 */
export async function classifyDocument(args: ClassifyArgs): Promise<ClassifierOutput> {
  const logger = (args.logger ?? noopLogger).child({ component: 'classifier' });
  const maxAttempts = args.maxAttempts ?? 2;

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = await args.llm.completeStructured<unknown>({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(args, lastIssue),
      schemaName: 'ClassifierOutput',
      maxTokens: args.maxTokens,
    });

    const parsed = ClassifierOutput.safeParse(candidate);
    if (parsed.success) {
      logger.info(
        { attempt, subtype: parsed.data.subtype, confidence: parsed.data.confidence },
        'document classified',
      );
      return parsed.data;
    }

    lastIssue = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    logger.warn({ attempt, issue: lastIssue }, 'classification failed schema validation');
  }

  throw new ClassificationError(
    `Classifier produced no schema-valid output after ${maxAttempts} attempt(s)`,
    maxAttempts,
    lastIssue,
  );
}
