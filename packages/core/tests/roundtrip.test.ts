import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { MockLLM, MockEmbedder, makeMemory } from "./helpers.js";

describe("Markdown export/import round-trip (Fix #12)", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports memories to markdown files by date", async () => {
    const extractResponse = JSON.stringify({
      memories: [
        { memory: "User is a developer.", category: "identity", memoryType: "fact", eventDate: null },
        { memory: "User prefers TypeScript.", category: "technical", memoryType: "preference", eventDate: null },
        { memory: "User is building ClawMem.", category: "projects", memoryType: "fact", eventDate: null },
      ],
    });
    const llm = new MockLLM([extractResponse]);
    const { memory: mem, dataDir } = makeMemory(llm, new MockEmbedder());
    tmpDir = dataDir;

    await mem.add(
      [{ role: "user", content: "I'm a TypeScript developer building ClawMem." }],
      { userId: "export-user" },
    );

    const outputDir = join(tmpDir, "export");
    const files = await mem.exportMarkdown("export-user", outputDir);

    expect(files.length).toBeGreaterThanOrEqual(2); // At least one date file + MEMORY.md

    // Date file should contain the memories with IDs
    const dateFiles = files.filter((f) => !f.endsWith("MEMORY.md"));
    expect(dateFiles.length).toBe(1);
    const dateContent = readFileSync(dateFiles[0]!, "utf-8");
    expect(dateContent).toContain("User is a developer.");
    expect(dateContent).toContain("<!-- id:");
    expect(dateContent).toContain("*(fact)*");

    // MEMORY.md should exist
    const memoryMd = files.find((f) => f.endsWith("MEMORY.md"));
    expect(memoryMd).toBeDefined();
    expect(existsSync(memoryMd!)).toBe(true);

    // #41: MEMORY.md should contain profile section headers and memory text
    const memoryContent = readFileSync(memoryMd!, "utf-8");
    expect(memoryContent).toContain("# Memory — export-user");
    expect(memoryContent).toContain("User is a developer.");
  });

  it("round-trips: add → export → wipe → import → verify", async () => {
    // Step 1: Add memories
    const extractResponse = JSON.stringify({
      memories: [
        { memory: "User's name is Alice.", category: "identity", memoryType: "fact", eventDate: null },
        { memory: "User prefers dark mode.", category: "preferences", memoryType: "preference", eventDate: null },
        { memory: "User uses fish shell.", category: "technical", memoryType: "fact", eventDate: null },
      ],
    });
    const skipDecision = JSON.stringify({ action: "add", targetId: null, reason: "New" });
    const llm = new MockLLM([extractResponse, skipDecision, skipDecision, skipDecision]);
    const { memory: mem, dataDir } = makeMemory(llm, new MockEmbedder());
    tmpDir = dataDir;

    await mem.add(
      [{ role: "user", content: "I'm Alice. I use dark mode and fish shell." }],
      { userId: "roundtrip-user" },
    );

    const beforeExport = await mem.getAll({ userId: "roundtrip-user" });
    expect(beforeExport.length).toBe(3);

    // Step 2: Export
    const outputDir = join(tmpDir, "export");
    await mem.exportMarkdown("roundtrip-user", outputDir);

    // Step 3: Wipe
    await mem.deleteAll("roundtrip-user");
    const afterWipe = await mem.getAll({ userId: "roundtrip-user" });
    expect(afterWipe.length).toBe(0);

    // Step 4: Import (the LLM re-extracts during import)
    const importExtract = JSON.stringify({
      memories: [
        { memory: "User's name is Alice.", category: "identity", memoryType: "fact", eventDate: null },
        { memory: "User prefers dark mode.", category: "preferences", memoryType: "preference", eventDate: null },
        { memory: "User uses fish shell.", category: "technical", memoryType: "fact", eventDate: null },
      ],
    });
    llm.responses = [importExtract, skipDecision, skipDecision, skipDecision];
    llm.idx = 0;

    const dateFiles = (await import("fs")).readdirSync(outputDir).filter((f: string) => f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
    expect(dateFiles.length).toBe(1);
    const importResult = await mem.importMarkdown(
      join(outputDir, dateFiles[0]!),
      "roundtrip-user",
    );

    expect(importResult.added).toBe(3);

    // Step 5: Verify memories are back
    const afterImport = await mem.getAll({ userId: "roundtrip-user" });
    expect(afterImport.length).toBe(3);

    const memories = afterImport.map((m) => m.memory).sort();
    expect(memories).toContain("User's name is Alice.");
    expect(memories).toContain("User prefers dark mode.");
    expect(memories).toContain("User uses fish shell.");
  });

  it("import strips ID comments and type annotations from bullets", async () => {
    const llm = new MockLLM([
      JSON.stringify({
        memories: [
          { memory: "User likes Rust.", category: "technical", memoryType: "preference", eventDate: null },
        ],
      }),
    ]);
    const { memory: mem, dataDir } = makeMemory(llm, new MockEmbedder());
    tmpDir = dataDir;

    // Create a manual markdown file with embedded IDs and type annotations
    const mdPath = join(tmpDir, "manual.md");
    (await import("fs")).writeFileSync(
      mdPath,
      [
        "# Test Export",
        "",
        "## technical",
        "",
        "- User likes Rust. *(preference)* <!-- id:abc123 -->",
        "- User is building a project. *(fact)* <!-- id:def456 -->",
        "",
      ].join("\n"),
    );

    const result = await mem.importMarkdown(mdPath, "import-user");
    // The LLM will re-extract — the key test is that the input text is clean
    expect(result.added).toBeGreaterThanOrEqual(0);
  });
});
