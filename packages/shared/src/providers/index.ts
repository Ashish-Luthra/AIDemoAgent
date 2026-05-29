/**
 * Provider abstractions (KICKOFF Architecture Lock #7 — non-negotiable).
 *
 * Every external model/API lives behind a typed interface here so swapping a
 * vendor is a one-file change in the implementing package. STT/TTS are stubbed
 * (interfaces only) in Phase 1 — voice is the Phase 2 wrapper.
 */

/** LLM — Anthropic Claude. Structured output is mandatory (Zod-validated). */
export interface LlmProvider {
  /** Single non-streaming structured call (ingestion classifier path). */
  completeStructured<T>(args: {
    system?: string;
    prompt: string;
    /** JSON schema the model must satisfy; caller validates with Zod. */
    schemaName: string;
    maxTokens?: number;
  }): Promise<T>;

  /** Streaming turn-loop call (runtime brain — single call per turn). */
  streamTurn(args: { system?: string; prompt: string; maxTokens?: number }): AsyncIterable<string>;
}

/** Text embeddings — OpenAI text-embedding-3-large by default. */
export interface TextEmbeddingProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Image embeddings — CLIP-style, for Creative Studio visual similarity. */
export interface ImageEmbeddingProvider {
  readonly dimensions: number;
  embedImages(imageUris: string[]): Promise<number[][]>;
}

/** Reranker — Cohere Rerank by default. The precision arm of hybrid search. */
export interface RerankerProvider {
  rerank(args: {
    query: string;
    documents: { id: string; text: string }[];
    topN?: number;
  }): Promise<{ id: string; relevanceScore: number }[]>;
}

/** Document extraction — LlamaParse for docs/PPTs. */
export interface DocumentExtractionProvider {
  extract(args: { uri: string; mimeType: string }): Promise<{ markdown: string }>;
}

/** Batch transcription — OpenAI Whisper. Audio/video, off the hot path. */
export interface TranscriptionProvider {
  transcribe(args: { uri: string }): Promise<{ text: string }>;
}

/** STT — stubbed in Phase 1 (Phase 2 voice wrapper). */
export interface SttProvider {
  readonly __phase2Stub: true;
}

/** TTS — stubbed in Phase 1 (Phase 2 voice wrapper). */
export interface TtsProvider {
  readonly __phase2Stub: true;
}
