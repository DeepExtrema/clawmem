import type { Command } from "commander";
import { loadConfig, createMemory } from "../config.js";
import { join } from "path";
import { DEFAULT_DATA_DIR } from "../config.js";

export function registerExport(program: Command): void {
  program
    .command("export")
    .description("Export memories to markdown files (one per day + MEMORY.md summary)")
    .option("-u, --user <id>", "User ID")
    .option("-o, --output <dir>", "Output directory", join(DEFAULT_DATA_DIR, "export"))
    .option("--all-versions", "Include superseded versions (not just latest)")
    .action(async (opts: { user?: string; output: string; allVersions?: boolean }) => {
      const config = loadConfig();
      const mem = createMemory(config);
      const userId = opts.user ?? config.userId;

      try {
        const written = await mem.exportMarkdown(userId, opts.output, {
          onlyLatest: !opts.allVersions,
        });
        console.log(`✅ Exported ${written.length} file(s) to: ${opts.output}`);
        for (const f of written) console.log(`   ${f}`);
      } catch (err) {
        console.error("❌ Export failed:", (err as Error).message);
        process.exit(1);
      }
    });
}

export function registerImport(program: Command): void {
  program
    .command("import <file>")
    .description("Import memories from a markdown file (each bullet point is extracted as a memory)")
    .option("-u, --user <id>", "User ID")
    .option("--instructions <text>", "Extra instructions for the LLM extractor")
    .action(async (file: string, opts: { user?: string; instructions?: string }) => {
      const config = loadConfig();
      const mem = createMemory(config);
      const userId = opts.user ?? config.userId;

      try {
        console.log(`📥 Importing from: ${file}`);
        const result = await mem.importMarkdown(file, userId, {
          ...(opts.instructions !== undefined && { customInstructions: opts.instructions }),
        });
        console.log(`✅ Import complete:`);
        console.log(`   Added:   ${result.added}`);
        console.log(`   Updated: ${result.updated}`);
        console.log(`   Skipped: ${result.skipped} (duplicates)`);
      } catch (err) {
        console.error("❌ Import failed:", (err as Error).message);
        process.exit(1);
      }
    });
}
