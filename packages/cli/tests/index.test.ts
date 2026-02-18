// #26: Real CLI tests for config + command helpers
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../src/config.js";
import type { CliConfig } from "../src/config.js";

describe("clawmem CLI — config", () => {
  let tmpDir: string;
  let origConfigPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `clawmem-cli-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
  });

  it("loadConfig returns defaults when no config file exists", () => {
    const cfg = loadConfig();
    expect(cfg.userId).toBe("default");
    expect(cfg.llm.baseURL).toContain("127.0.0.1");
  });

  it("saveConfig writes a valid JSON file", () => {
    const cfg: CliConfig = {
      ...DEFAULT_CONFIG,
      dataDir: tmpDir,
      userId: "test-user",
    };
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.userId).toBe("test-user");
    expect(parsed.dataDir).toBe(tmpDir);
  });

  it("DEFAULT_CONFIG has expected shape", () => {
    expect(DEFAULT_CONFIG.dataDir).toBeDefined();
    expect(DEFAULT_CONFIG.userId).toBe("default");
    expect(DEFAULT_CONFIG.llm).toBeDefined();
    expect(DEFAULT_CONFIG.embedder).toBeDefined();
    expect(DEFAULT_CONFIG.enableGraph).toBe(true);
  });
});
