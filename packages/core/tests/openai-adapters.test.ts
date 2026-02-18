import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatLLM } from "../src/backends/openai-compat-llm.js";
import { OpenAICompatEmbedder } from "../src/backends/openai-compat-embedder.js";
import { LLMError, EmbedderError } from "../src/errors.js";

const originalFetch = globalThis.fetch;

function mockOkJsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("OpenAI-compatible adapters", () => {
  it("LLM adapter throws LLMError for non-2xx responses", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
    } as unknown as Response)) as unknown as typeof fetch;

    const llm = new OpenAICompatLLM({
      baseURL: "http://localhost:1234/v1",
      model: "test-model",
    });

    await expect(
      llm.complete([{ role: "user", content: "hello" }]),
    ).rejects.toBeInstanceOf(LLMError);
  });

  it("LLM adapter throws timeout error when request aborts", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as unknown as typeof fetch;

    const llm = new OpenAICompatLLM({
      baseURL: "http://localhost:1234/v1",
      timeoutMs: 25,
    });

    await expect(
      llm.complete([{ role: "user", content: "timeout me" }]),
    ).rejects.toThrow("timed out");
  });

  it("Embedder adapter throws EmbedderError for non-2xx responses", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "internal error",
    } as unknown as Response)) as unknown as typeof fetch;

    const embedder = new OpenAICompatEmbedder({
      baseURL: "http://localhost:1234/v1",
      model: "test-embedder",
      dimension: 3,
    });

    await expect(embedder.embed("hello")).rejects.toBeInstanceOf(EmbedderError);
  });

  it("Embedder preserves input ordering across concurrent chunks", async () => {
    const pending: Array<{
      resolve: (value: Response) => void;
      input: string[];
    }> = [];

    globalThis.fetch = vi.fn((_url, init) =>
      new Promise((resolve) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { input: string[] };
        pending.push({ resolve, input: body.input });
      }),
    ) as unknown as typeof fetch;

    const embedder = new OpenAICompatEmbedder({
      baseURL: "http://localhost:1234/v1",
      batchSize: 2,
      concurrency: 2,
      dimension: 2,
    });

    const promise = embedder.embedBatch(["a", "b", "c", "d"]);
    await Promise.resolve();
    await Promise.resolve();

    expect(pending).toHaveLength(2);
    expect(pending[0]!.input).toEqual(["a", "b"]);
    expect(pending[1]!.input).toEqual(["c", "d"]);

    // Resolve second chunk first to ensure deterministic merge by chunk index.
    pending[1]!.resolve(
      mockOkJsonResponse({
        data: [
          { index: 1, embedding: [40, 40] },
          { index: 0, embedding: [30, 30] },
        ],
      }),
    );
    pending[0]!.resolve(
      mockOkJsonResponse({
        data: [
          { index: 1, embedding: [20, 20] },
          { index: 0, embedding: [10, 10] },
        ],
      }),
    );

    await expect(promise).resolves.toEqual([
      [10, 10],
      [20, 20],
      [30, 30],
      [40, 40],
    ]);
  });
});
