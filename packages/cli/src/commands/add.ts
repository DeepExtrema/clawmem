import type { Command } from "commander";
import { loadConfig, createMemory } from "../config.js";

export function registerAdd(program: Command): void {
  program
    .command("add <text>")
    .description("Add a memory from text (LLM extracts facts from the input)")
    .option("-u, --user <id>", "User ID")
    .option("--instructions <text>", "Extra instructions for the LLM extractor")
    .action(async (text: string, opts: {
      user?: string;
      instructions?: string;
    }) => {
      const config = loadConfig();
      const mem = createMemory(config);
      const userId = opts.user ?? config.userId;

      try {
        const result = await mem.add(
          [{ role: "user", content: text }],
          { userId, customInstructions: opts.instructions },
        );

        if (result.added.length > 0) {
          console.log(`✅ ${result.added.length} memory/memories added:`);
          for (const m of result.added) {
            console.log(`   ${m.id.slice(0, 8)}…  "${m.memory}"`);
          }
        }
        if (result.updated.length > 0) {
          console.log(`🔄 ${result.updated.length} memory/memories updated:`);
          for (const m of result.updated) {
            console.log(`   ${m.id.slice(0, 8)}…  "${m.memory}"`);
          }
        }
        if (result.skipped.length > 0) {
          console.log(`⏭️  ${result.skipped.length} skipped (duplicates)`);
        }
        if (result.added.length === 0 && result.updated.length === 0) {
          console.log("No memories extracted from input.");
        }
      } catch (err) {
        console.error("❌ Add failed:", (err as Error).message);
        process.exit(1);
      }
    });
}
