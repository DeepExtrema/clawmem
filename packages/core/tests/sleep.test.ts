// #25: SleepMode unit tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import { SleepMode } from "../src/sleep.js";
import { MockLLM } from "./helpers.js";

describe("SleepMode", () => {
  let logDir: string;
  let sleepMode: SleepMode;
  let llm: MockLLM;
  let mockMemory: { add: ReturnType<typeof vi.fn> };

  function vi_fn() {
    let calls: unknown[][] = [];
    const fn = (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ added: [{ id: "m1" }], updated: [] });
    };
    fn.mock = { get calls() { return calls.map(a => ({ arguments: a })); } };
    fn.calls = calls;
    return fn;
  }

  beforeEach(() => {
    logDir = join(tmpdir(), `clawmem-sleep-test-${randomUUID()}`);
    mkdirSync(logDir, { recursive: true });

    const analysisResponse = JSON.stringify({
      newFacts: ["User likes TypeScript", "User prefers dark mode"],
      patterns: ["Talks about coding"],
      summary: "User discussed coding preferences.",
    });
    llm = new MockLLM([analysisResponse]);

    mockMemory = { add: vi_fn() };

    sleepMode = new SleepMode(
      mockMemory as never,
      llm,
      { logDir, retentionDays: 7 },
    );
  });

  afterEach(() => {
    try { rmSync(logDir, { recursive: true }); } catch { /* ok */ }
  });

  it("appendConversation creates a JSONL file", () => {
    sleepMode.appendConversation("user1", [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(logDir, `${today}.jsonl`);
    expect(existsSync(logFile)).toBe(true);

    const content = readFileSync(logFile, "utf-8").trim();
    const entry = JSON.parse(content);
    expect(entry.userId).toBe("user1");
    expect(entry.messages).toHaveLength(2);
  });

  it("run extracts facts and stores them as memories", async () => {
    const today = new Date().toISOString().slice(0, 10);
    sleepMode.appendConversation("user1", [
      { role: "user", content: "I really like TypeScript" },
    ]);

    const digest = await sleepMode.run("user1", { date: today });
    expect(digest.memoriesExtracted).toBe(1); // from mock add
    expect(digest.patterns).toContain("Talks about coding");
    expect(digest.summary).toBe("User discussed coding preferences.");
    expect(mockMemory.add.calls.length).toBe(1);
  });

  it("run with dryRun does not store memories", async () => {
    const today = new Date().toISOString().slice(0, 10);
    sleepMode.appendConversation("user1", [
      { role: "user", content: "Some conversation" },
    ]);

    const digest = await sleepMode.run("user1", { date: today, dryRun: true });
    expect(digest.memoriesExtracted).toBe(0);
    expect(mockMemory.add.calls.length).toBe(0);
  });

  it("run returns empty digest for missing log file", async () => {
    const digest = await sleepMode.run("user1", { date: "2020-01-01" });
    expect(digest.memoriesExtracted).toBe(0);
    expect(digest.summary).toBe("No conversations found for this date.");
  });

  it("cleanup removes old log files", () => {
    // Create an old log file
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const oldFile = join(logDir, `${oldDate}.jsonl`);
    mkdirSync(join(logDir), { recursive: true });
    require("fs").writeFileSync(oldFile, '{"test":true}\n');

    const removed = sleepMode.cleanup();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(oldFile)).toBe(false);
  });

  it("processed sidecar prevents reprocessing", async () => {
    const today = new Date().toISOString().slice(0, 10);
    sleepMode.appendConversation("user1", [
      { role: "user", content: "First conversation" },
    ]);

    // First run — processes entries
    await sleepMode.run("user1", { date: today });

    // Check sidecar exists
    const processedFile = join(logDir, `${today}.jsonl.processed`);
    expect(existsSync(processedFile)).toBe(true);

    // Reset mock calls
    mockMemory.add.calls.length = 0;
    llm.idx = 0;

    // Second run — should find no unprocessed entries
    const digest2 = await sleepMode.run("user1", { date: today });
    expect(digest2.summary).toBe("No unprocessed conversations found.");
  });

  it("writes digest file after run", async () => {
    const today = new Date().toISOString().slice(0, 10);
    sleepMode.appendConversation("user1", [
      { role: "user", content: "Some chat" },
    ]);

    await sleepMode.run("user1", { date: today });

    const digestDir = join(logDir, "digests");
    const digestFile = join(digestDir, `${today}-user1.json`);
    expect(existsSync(digestFile)).toBe(true);

    const digest = JSON.parse(readFileSync(digestFile, "utf-8"));
    expect(digest.userId).toBe("user1");
  });
});
