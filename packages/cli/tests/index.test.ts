// #26: Real CLI tests for config + command helpers
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
  CONFIG_PATH,
} from "../src/config.js";
import type { CliConfig } from "../src/config.js";

describe("clawmem CLI — config", () => {
  let tmpDir: string;
  let previousConfig: string | null;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `clawmem-cli-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    previousConfig = existsSync(CONFIG_PATH)
      ? readFileSync(CONFIG_PATH, "utf-8")
      : null;
    // Ensure deterministic defaults for each test.
    rmSync(CONFIG_PATH, { force: true });
  });

  afterEach(() => {
    try {
      if (previousConfig !== null) {
        saveConfig(JSON.parse(previousConfig) as CliConfig);
      } else {
        rmSync(CONFIG_PATH, { force: true });
      }
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
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
    saveConfig(cfg);
    const loaded = loadConfig();
    expect(loaded.userId).toBe("test-user");
    expect(loaded.dataDir).toBe(tmpDir);
  });

  it("DEFAULT_CONFIG has expected shape", () => {
    expect(DEFAULT_CONFIG.dataDir).toBeDefined();
    expect(DEFAULT_CONFIG.userId).toBe("default");
    expect(DEFAULT_CONFIG.llm).toBeDefined();
    expect(DEFAULT_CONFIG.embedder).toBeDefined();
    expect(DEFAULT_CONFIG.enableGraph).toBe(true);
  });
});
