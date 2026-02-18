import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, homedir } from "path";
import { Memory } from "@clawmem/core";
import type { ClawMemConfig } from "@clawmem/core";

export const DEFAULT_DATA_DIR = join(homedir(), ".clawmem");
export const CONFIG_PATH = join(DEFAULT_DATA_DIR, "config.json");

export interface CliConfig {
  dataDir: string;
  userId: string;
  llm: { baseURL: string; model?: string; apiKey?: string };
  embedder: { baseURL: string; model?: string; dimension?: number; apiKey?: string };
  enableGraph?: boolean;
  dedupThreshold?: number;
  defaultTopK?: number;
}

export const DEFAULT_CONFIG: CliConfig = {
  dataDir: DEFAULT_DATA_DIR,
  userId: "default",
  llm: { baseURL: "http://127.0.0.1:8080/v1", model: "local" },
  embedder: { baseURL: "http://127.0.0.1:8082/v1", model: "nomic-embed-text", dimension: 768 },
  enableGraph: true,
};

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as CliConfig;
  } catch {
    console.error("⚠️  Failed to parse config at", CONFIG_PATH);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function createMemory(config: CliConfig): Memory {
  const memConfig: ClawMemConfig = {
    dataDir: config.dataDir,
    llm: config.llm,
    embedder: config.embedder,
    enableGraph: config.enableGraph ?? true,
    dedupThreshold: config.dedupThreshold,
    defaultTopK: config.defaultTopK,
  };
  return new Memory(memConfig);
}
