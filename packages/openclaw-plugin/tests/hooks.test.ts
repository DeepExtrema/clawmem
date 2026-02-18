import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryInstances: Array<{
  search: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@clawmem/core", () => {
  class MemoryMock {
    search = vi.fn().mockResolvedValue([]);
    add = vi.fn().mockResolvedValue({ added: [], updated: [], deduplicated: 0 });
    getAll = vi.fn().mockResolvedValue([]);
    get = vi.fn().mockResolvedValue(null);
    delete = vi.fn().mockResolvedValue(undefined);
    deleteAll = vi.fn().mockResolvedValue(undefined);
    profile = vi.fn().mockResolvedValue({
      userId: "default",
      static: { identity: [], preferences: [], technical: [], relationships: [] },
      dynamic: { goals: [], projects: [], lifeEvents: [] },
      other: [],
      generatedAt: new Date().toISOString(),
    });
    exportMarkdown = vi.fn().mockResolvedValue([]);
    importMarkdown = vi.fn().mockResolvedValue({ added: 0, updated: 0, skipped: 0 });
    close = vi.fn().mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_cfg: unknown) {
      memoryInstances.push(this);
    }
  }

  return {
    Memory: MemoryMock,
    buildProfileSummary: vi.fn(() => "mock profile summary"),
  };
});

function createMockApi(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | void>();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };

  const api = {
    pluginConfig: {
      userId: "default-user",
      autoRecall: true,
      autoCapture: true,
      skipGroupChats: true,
      searchThreshold: 0.3,
      topK: 5,
      enableGraph: false,
      llm: { baseURL: "http://127.0.0.1:9999/v1" },
      embedder: { baseURL: "http://127.0.0.1:9999/v1" },
      dataDir: "/tmp/clawmem-plugin-hooks",
      ...overrides,
    },
    logger,
    resolvePath: (p: string) => p,
    registerTool: vi.fn(),
    registerCli: vi.fn(),
    on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | void) => {
      handlers.set(event, handler);
    },
    registerService: vi.fn(),
  };

  return { api, handlers, logger };
}

describe("@clawmem/openclaw hook behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryInstances.length = 0;
  });

  it("injects relevant memories in before_agent_start recall hook", async () => {
    const mod = await import("../src/index.js");
    const { api, handlers } = createMockApi({ autoRecall: true, autoCapture: false });
    mod.default.register(api as never);

    const mem = memoryInstances.at(-1)!;
    mem.search.mockResolvedValueOnce([
      {
        id: "m1",
        memory: "User prefers fish shell.",
        category: "technical",
        score: 0.92,
      },
    ]);

    const recallHook = handlers.get("before_agent_start");
    expect(recallHook).toBeDefined();

    const out = await recallHook!(
      { prompt: "What shell do I use?" },
      { userId: "alice", isGroup: false },
    ) as { prependContext?: string } | undefined;

    expect(mem.search).toHaveBeenCalledWith("What shell do I use?", {
      userId: "alice",
      limit: 5,
      threshold: 0.3,
    });
    expect(out?.prependContext).toContain("User prefers fish shell.");
  });

  it("skips recall for group chats when skipGroupChats is enabled", async () => {
    const mod = await import("../src/index.js");
    const { api, handlers, logger } = createMockApi({ autoRecall: true, skipGroupChats: true });
    mod.default.register(api as never);

    const mem = memoryInstances.at(-1)!;
    const recallHook = handlers.get("before_agent_start");
    expect(recallHook).toBeDefined();

    const out = await recallHook!(
      { prompt: "Should be skipped" },
      { isGroup: true, userId: "alice" },
    );

    expect(out).toBeUndefined();
    expect(mem.search).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith("clawmem: skipping group chat recall");
  });

  it("captures recent user/human messages in agent_end hook", async () => {
    const mod = await import("../src/index.js");
    const { api, handlers } = createMockApi({ autoRecall: false, autoCapture: true });
    mod.default.register(api as never);

    const mem = memoryInstances.at(-1)!;
    mem.add.mockResolvedValueOnce({
      added: [{ id: "m1", memory: "User is planning a migration." }],
      updated: [],
      deduplicated: 0,
    });

    const captureHook = handlers.get("agent_end");
    expect(captureHook).toBeDefined();

    await captureHook!(
      {
        success: true,
        messages: [
          { role: "assistant", content: "hello" },
          { role: "user", content: "I am planning a migration." },
          { role: "assistant", content: "got it" },
          { role: "human", content: "Target is Q3." },
        ],
      },
      { userId: "alice", isGroup: false },
    );

    expect(mem.add).toHaveBeenCalledTimes(1);
    expect(mem.add).toHaveBeenCalledWith(
      [
        { role: "user", content: "I am planning a migration." },
        { role: "user", content: "Target is Q3." },
      ],
      { userId: "alice" },
    );
  });
});
