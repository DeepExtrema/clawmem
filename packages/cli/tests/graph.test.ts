import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

vi.mock("../src/command-base.js", () => ({
  withMemory: vi.fn(),
}));

import { withMemory } from "../src/command-base.js";
import { registerGraph } from "../src/commands/graph.js";

const withMemoryMock = vi.mocked(withMemory);

function makeProgram(): Command {
  const program = new Command();
  registerGraph(program);
  return program;
}

async function runGraphCommand(
  args: string[],
  mem: {
    graphRelations: (userId: string, opts?: { limit?: number; offset?: number }) => Promise<unknown>;
    graphEntities: (userId: string, opts?: { query?: string; limit?: number; offset?: number }) => Promise<unknown>;
    graphSearch: (query: string, userId: string, opts?: { limit?: number; offset?: number }) => Promise<unknown>;
  },
): Promise<string[]> {
  withMemoryMock.mockImplementationOnce(async (_opts, fn) => {
    await fn({
      mem: mem as never,
      userId: "user-1",
      config: {} as never,
    });
  });

  const logs: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...items) => {
    logs.push(items.map((item) => String(item)).join(" "));
  });

  try {
    await makeProgram().parseAsync(["graph", ...args], { from: "user" });
  } finally {
    logSpy.mockRestore();
  }
  return logs;
}

describe("clawmem graph command", () => {
  beforeEach(() => {
    withMemoryMock.mockReset();
  });

  it("relations --json calls Memory with parsed pagination options", async () => {
    const mem = {
      graphRelations: vi.fn().mockResolvedValue([
        { sourceName: "Alice", relationship: "RELATES_TO", targetName: "TypeScript" },
      ]),
      graphEntities: vi.fn(),
      graphSearch: vi.fn(),
    };

    const logs = await runGraphCommand(
      ["relations", "--json", "--limit", "2", "--offset", "1"],
      mem,
    );

    expect(mem.graphRelations).toHaveBeenCalledWith("user-1", {
      limit: 2,
      offset: 1,
    });
    expect(JSON.parse(logs[0] ?? "[]")).toHaveLength(1);
  });

  it("entities prints an explicit empty-state message", async () => {
    const mem = {
      graphRelations: vi.fn(),
      graphEntities: vi.fn().mockResolvedValue([]),
      graphSearch: vi.fn(),
    };

    const logs = await runGraphCommand(["entities"], mem);
    expect(mem.graphEntities).toHaveBeenCalledWith("user-1", {
      query: undefined,
      limit: 100,
      offset: 0,
    });
    expect(logs.some((line) => line.includes("No entities found."))).toBe(true);
  });

  it("search delegates to Memory.graphSearch and renders relationships", async () => {
    const mem = {
      graphRelations: vi.fn(),
      graphEntities: vi.fn(),
      graphSearch: vi.fn().mockResolvedValue([
        { sourceName: "Alice", relationship: "ABOUT", targetName: "Graph Databases" },
      ]),
    };

    const logs = await runGraphCommand(["search", "Alice"], mem);
    expect(mem.graphSearch).toHaveBeenCalledWith("Alice", "user-1", {
      limit: 50,
      offset: 0,
    });
    expect(logs.some((line) => line.includes("Graph Databases"))).toBe(true);
  });

  it("rejects invalid --limit values", async () => {
    const mem = {
      graphRelations: vi.fn().mockResolvedValue([]),
      graphEntities: vi.fn().mockResolvedValue([]),
      graphSearch: vi.fn().mockResolvedValue([]),
    };

    await expect(
      runGraphCommand(["relations", "--limit", "0"], mem),
    ).rejects.toThrow("--limit must be a positive integer");
  });
});
