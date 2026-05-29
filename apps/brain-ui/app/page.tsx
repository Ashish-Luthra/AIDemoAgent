'use client';

import { useState } from 'react';
import type { RetrievalResult } from '@allyvate/shared';
import { formatConfidence } from '@/lib/format';

const API_URL = process.env.NEXT_PUBLIC_BRAIN_API_URL ?? 'http://localhost:4000';
// Placeholder tenant until Clerk auth wires the real boundary (Week 7).
const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export default function Home() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<RetrievalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/retrieve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: DEMO_TENANT_ID, question }),
      });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      setResult((await res.json()) as RetrievalResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <header>
        <h1 className="text-2xl font-semibold">Allyvate Brain</h1>
        <p className="text-sm text-neutral-500">
          Phase 1 tester — ask a question, see the top artifact, confidence, reasoning trace, and
          alternatives.
        </p>
      </header>

      <form onSubmit={ask} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What case study fits a security-conscious CISO?"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={loading || question.trim().length === 0}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">{result.topArtifactId ?? 'No artifact selected yet'}</h2>
            <span className="text-sm text-neutral-500">
              confidence {formatConfidence(result.confidence)}
            </span>
          </div>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {result.reasoningTrace}
          </p>
          {result.alternatives.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm">
              {result.alternatives.map((alt) => (
                <li key={alt.artifactId}>
                  {alt.title} — {alt.subtype} ({alt.score.toFixed(2)})
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
