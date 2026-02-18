/**
 * Sleep Mode — P4-7
 *
 * Nightly memory maintenance:
 * - Scans recent conversation logs
 * - Extracts missed facts
 * - Consolidates duplicate memories
 * - Produces a daily digest
 *
 * Usage:
 *   const sleep = new SleepMode(memory, { logDir: "~/.clawmem/logs" });
 *   const digest = await sleep.run(userId);
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import type { LLM, ConversationMessage } from "./interfaces/index.js";
import { now } from "./utils/index.js";

export interface SleepModeConfig {
  /** Directory to store conversation logs */
  logDir: string;
  /** Directory to store daily digests */
  digestDir?: string;
  /** Max characters per chunk when analyzing logs */
  maxChunkChars?: number;
  /** Number of days to retain logs */
  retentionDays?: number;
}

export interface ConversationLogEntry {
  timestamp: string;
  userId: string;
  messages: Array<{ role: string; content: string }>;
  processed: boolean;
}

export interface SleepDigest {
  date: string;
  userId: string;
  memoriesExtracted: number;
  memoriesUpdated: number;
  patterns: string[];
  summary: string;
  generatedAt: string;
}

function buildSleepAnalysisPrompt(
  conversations: string,
  userId: string,
): string {
  return `You are analyzing recent conversations for a user (${userId}) to extract any facts
that were discussed but may not have been captured in long-term memory.

## Conversations to analyze
${conversations}

## Your task
1. Extract NEW facts, preferences, or important events mentioned in these conversations
2. Identify any patterns or themes (e.g., recurring topics, evolving opinions)
3. Write a brief 2-3 sentence summary of what happened in these conversations

Return a JSON object:
{
  "newFacts": [
    "The user mentioned they are starting a new project called X",
    "The user expressed frustration with Y and wants to switch to Z"
  ],
  "patterns": [
    "User frequently discusses TypeScript tooling",
    "User is actively working on OpenClaw integrations"
  ],
  "summary": "Brief summary of the conversations..."
}

Return ONLY valid JSON. No markdown, no explanation.`;
}

export class SleepMode {
  private readonly logDir: string;
  private readonly digestDir: string;
  private readonly maxChunkChars: number;
  private readonly retentionDays: number;

  constructor(
    private readonly memory: {
      add(messages: ConversationMessage[], opts: { userId: string }): Promise<{ added: unknown[]; updated: unknown[] }>;
    },
    private readonly llm: LLM,
    config: SleepModeConfig,
  ) {
    this.logDir = config.logDir;
    this.digestDir = config.digestDir ?? join(config.logDir, "digests");
    this.maxChunkChars = config.maxChunkChars ?? 8000;
    this.retentionDays = config.retentionDays ?? 30;
    mkdirSync(this.logDir, { recursive: true });
    mkdirSync(this.digestDir, { recursive: true });
  }

  /**
   * Append a conversation to the daily log.
   * Call this after each agent turn to capture conversations.
   */
  appendConversation(
    userId: string,
    messages: Array<{ role: string; content: string }>,
  ): void {
    const today = now().slice(0, 10);
    const logFile = join(this.logDir, `${today}.jsonl`);
    const entry: ConversationLogEntry = {
      timestamp: now(),
      userId,
      messages,
      processed: false,
    };
    appendFileSync(logFile, JSON.stringify(entry) + "\n");
  }

  /**
   * Run sleep mode analysis for a given date (default: yesterday).
   * Extracts missed facts from unprocessed logs and produces a digest.
   */
  async run(
    userId: string,
    opts: { date?: string; dryRun?: boolean } = {},
  ): Promise<SleepDigest> {
    const date = opts.date ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const logFile = join(this.logDir, `${date}.jsonl`);

    const digest: SleepDigest = {
      date,
      userId,
      memoriesExtracted: 0,
      memoriesUpdated: 0,
      patterns: [],
      summary: "No conversations found for this date.",
      generatedAt: now(),
    };

    if (!existsSync(logFile)) {
      return digest;
    }

    // Read and parse unprocessed entries
    const lines = readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
    const entries: ConversationLogEntry[] = lines
      .map((line) => {
        try { return JSON.parse(line) as ConversationLogEntry; } catch { return null; }
      })
      .filter((e): e is ConversationLogEntry => e !== null && !e.processed && e.userId === userId);

    if (entries.length === 0) {
      digest.summary = "No unprocessed conversations found.";
      return digest;
    }

    // Build conversation text for analysis
    const convText = entries
      .map((e) =>
        `[${e.timestamp}]\n` +
        e.messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
      )
      .join("\n\n---\n\n");

    // Chunk if too large
    const chunks: string[] = [];
    for (let i = 0; i < convText.length; i += this.maxChunkChars) {
      chunks.push(convText.slice(i, i + this.maxChunkChars));
    }

    const allNewFacts: string[] = [];
    const allPatterns: string[] = [];
    let finalSummary = "";

    for (const chunk of chunks) {
      try {
        const raw = await this.llm.complete(
          [{ role: "user", content: buildSleepAnalysisPrompt(chunk, userId) }],
          { json: true },
        );
        const result = JSON.parse(raw) as { newFacts?: string[]; patterns?: string[]; summary?: string };
        if (result.newFacts) allNewFacts.push(...result.newFacts);
        if (result.patterns) allPatterns.push(...result.patterns);
        if (result.summary) finalSummary = result.summary;
      } catch {
        // Best-effort analysis
      }
    }

    digest.patterns = allPatterns;
    digest.summary = finalSummary || `Analyzed ${entries.length} conversations.`;

    // Store new facts as memories (if not dry run)
    if (!opts.dryRun && allNewFacts.length > 0) {
      const messages: ConversationMessage[] = allNewFacts.map((f) => ({
        role: "user" as const,
        content: f,
      }));

      try {
        const result = await this.memory.add(messages, { userId });
        digest.memoriesExtracted = result.added.length;
        digest.memoriesUpdated = result.updated.length;
      } catch {
        // Best-effort storage
      }
    }

    // Mark entries as processed
    if (!opts.dryRun) {
      const updatedLines = lines.map((line) => {
        try {
          const entry = JSON.parse(line) as ConversationLogEntry;
          if (entry.userId === userId && !entry.processed) {
            return JSON.stringify({ ...entry, processed: true });
          }
        } catch { /* empty */ }
        return line;
      });
      writeFileSync(logFile, updatedLines.join("\n") + "\n");
    }

    // Write digest
    if (!opts.dryRun) {
      const digestFile = join(this.digestDir, `${date}-${userId}.json`);
      writeFileSync(digestFile, JSON.stringify(digest, null, 2));
    }

    return digest;
  }

  /**
   * Clean up logs older than retentionDays.
   */
  cleanup(): number {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    const { unlinkSync } = require("fs");

    try {
      const files = readdirSync(this.logDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const date = file.replace(".jsonl", "");
        const ts = new Date(date).getTime();
        if (!isNaN(ts) && ts < cutoff) {
          unlinkSync(join(this.logDir, file));
          removed++;
        }
      }
    } catch { /* best-effort */ }

    return removed;
  }
}
