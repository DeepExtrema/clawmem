import { describe, expect, it } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";
import { MockLLM, MockEmbedder, makeMemory } from "./helpers.js";

describe("Nightly deterministic integration", () => {
  it("runs add -> search -> export -> import cycle end-to-end", async () => {
    const llm = new MockLLM([
      JSON.stringify({
        memories: [
          {
            memory: "User prefers Rust for systems programming.",
            category: "technical",
            memoryType: "preference",
            eventDate: null,
          },
        ],
      }),
    ]);

    const { memory: mem, dataDir } = makeMemory(llm, new MockEmbedder());
    const exportDir = join(tmpdir(), `clawmem-nightly-export-${randomUUID()}`);
    mkdirSync(exportDir, { recursive: true });

    try {
      const addResult = await mem.add(
        [{ role: "user", content: "I prefer Rust for systems programming." }],
        { userId: "nightly-user" },
      );
      expect(addResult.added.length).toBe(1);

      const searchResult = await mem.search("systems programming", {
        userId: "nightly-user",
        threshold: 0,
      });
      expect(searchResult.length).toBeGreaterThan(0);

      const written = await mem.exportMarkdown("nightly-user", exportDir);
      expect(written.length).toBeGreaterThan(0);
      const dayFile = written.find((f) => !f.endsWith("MEMORY.md"));
      expect(dayFile).toBeDefined();

      await mem.deleteAll("nightly-user");
      expect((await mem.getAll({ userId: "nightly-user" })).length).toBe(0);

      await mem.importMarkdown(dayFile!, "nightly-user");
      const reloaded = await mem.search("Rust", {
        userId: "nightly-user",
        threshold: 0,
      });
      expect(reloaded.length).toBeGreaterThan(0);
    } finally {
      mem.close();
      rmSync(exportDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
