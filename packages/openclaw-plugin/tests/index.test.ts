import { describe, it, expect, vi, beforeEach } from "vitest";

describe("@clawmem/openclaw", () => {
  it("exports a plugin with a register function", async () => {
    const mod = await import("../src/index.js");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.register).toBe("function");
  });
});

describe("@clawmem/openclaw — plugin API surface", () => {
  it("registers tools, cli, hooks, and service when setup is called", async () => {
    const mod = await import("../src/index.js");

    const registeredTools: string[] = [];
    const registeredClis: string[][] = [];
    const registeredHooks: string[] = [];
    let serviceRegistered = false;

    const mockApi = {
      pluginConfig: {
        userId: "test-user",
        autoRecall: true,
        autoCapture: true,
        skipGroupChats: true,
        searchThreshold: 0.3,
        topK: 5,
        enableGraph: false,
        llm: { baseURL: "http://127.0.0.1:9999/v1" },
        embedder: { baseURL: "http://127.0.0.1:9999/v1" },
        dataDir: "/tmp/clawmem-test-plugin",
      },
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      resolvePath: (p: string) => p,
      registerTool: (tool: { name: string }) => { registeredTools.push(tool.name); },
      registerCli: (_fn: unknown, meta: { commands: string[] }) => { registeredClis.push(meta.commands); },
      on: (event: string) => { registeredHooks.push(event); },
      registerService: () => { serviceRegistered = true; },
    };

    // Setup should not throw (even if DB can't be reached - uses local SQLite)
    mod.default.register(mockApi as never);

    // Verify all 7 tools are registered
    expect(registeredTools).toContain("memory_search");
    expect(registeredTools).toContain("memory_store");
    expect(registeredTools).toContain("memory_store_raw");
    expect(registeredTools).toContain("memory_list");
    expect(registeredTools).toContain("memory_get");
    expect(registeredTools).toContain("memory_forget");
    expect(registeredTools).toContain("memory_profile");
    expect(registeredTools).toHaveLength(7);

    // Verify hooks registered
    expect(registeredHooks).toContain("before_agent_start");
    expect(registeredHooks).toContain("agent_end");

    // Verify CLI registered
    expect(registeredClis.some((c) => c.includes("clawmem"))).toBe(true);

    // Verify service registered
    expect(serviceRegistered).toBe(true);
  });

  it("does not register hooks when autoRecall/autoCapture are false", async () => {
    const mod = await import("../src/index.js");

    const registeredHooks: string[] = [];

    const mockApi = {
      pluginConfig: {
        userId: "test-user",
        autoRecall: false,
        autoCapture: false,
        skipGroupChats: true,
        enableGraph: false,
        llm: { baseURL: "http://127.0.0.1:9999/v1" },
        embedder: { baseURL: "http://127.0.0.1:9999/v1" },
        dataDir: "/tmp/clawmem-test-plugin-nohooks",
      },
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      resolvePath: (p: string) => p,
      registerTool: vi.fn(),
      registerCli: vi.fn(),
      on: (event: string) => { registeredHooks.push(event); },
      registerService: vi.fn(),
    };

    mod.default.register(mockApi as never);
    expect(registeredHooks).not.toContain("before_agent_start");
    expect(registeredHooks).not.toContain("agent_end");
  });
});
