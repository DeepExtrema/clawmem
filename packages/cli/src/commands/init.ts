import type { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { DEFAULT_DATA_DIR, CONFIG_PATH, DEFAULT_CONFIG, saveConfig } from "../config.js";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize ClawMem — create config and data directory")
    .option("--llm-url <url>", "LLM endpoint URL", "http://127.0.0.1:8080/v1")
    .option("--embed-url <url>", "Embedder endpoint URL", "http://127.0.0.1:8082/v1")
    .option("--llm-model <model>", "LLM model name", "local")
    .option("--embed-model <model>", "Embedder model name", "nomic-embed-text")
    .option("--data-dir <dir>", "Data directory", DEFAULT_DATA_DIR)
    .option("--user-id <id>", "Default user ID", "default")
    .option("--no-graph", "Disable graph memory (Kùzu)")
    .action((opts: {
      llmUrl: string;
      embedUrl: string;
      llmModel: string;
      embedModel: string;
      dataDir: string;
      userId: string;
      graph: boolean;
    }) => {
      mkdirSync(opts.dataDir, { recursive: true });

      const config = {
        ...DEFAULT_CONFIG,
        dataDir: opts.dataDir,
        userId: opts.userId,
        llm: { baseURL: opts.llmUrl, model: opts.llmModel },
        embedder: { baseURL: opts.embedUrl, model: opts.embedModel, dimension: 768 },
        enableGraph: opts.graph,
      };

      saveConfig(config);

      console.log("✅ ClawMem initialized!");
      console.log(`   Config:  ${CONFIG_PATH}`);
      console.log(`   Data:    ${opts.dataDir}`);
      console.log(`   LLM:     ${opts.llmUrl} (${opts.llmModel})`);
      console.log(`   Embedder:${opts.embedUrl} (${opts.embedModel})`);
      console.log(`   Graph:   ${opts.graph ? "enabled (Kùzu)" : "disabled"}`);
      console.log("\nRun `clawmem doctor` to verify your setup.");
    });
}
