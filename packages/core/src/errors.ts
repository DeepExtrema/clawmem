/**
 * ClawMem error hierarchy.
 *
 * All ClawMem errors extend ClawMemError so callers can:
 *   catch (err) { if (err instanceof ClawMemError) ... }
 * Or catch specific subtypes:
 *   catch (err) { if (err instanceof LLMError) ... }
 */

export class ClawMemError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClawMemError";
  }
}

/** LLM request failed (timeout, HTTP error, empty response) */
export class LLMError extends ClawMemError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LLMError";
  }
}

/** Embedder request failed (timeout, HTTP error, dimension mismatch) */
export class EmbedderError extends ClawMemError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbedderError";
  }
}

/** Storage layer error (SQLite, vector store, graph store) */
export class StorageError extends ClawMemError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageError";
  }
}
