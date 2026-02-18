import type { Command } from "commander";
import { withMemory } from "../command-base.js";

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
      await withMemory(opts, async ({ mem, userId }) => {
        const result = await mem.add(
          [{ role: "user", content: text }],
          { userId, ...(opts.instructions !== undefined && { customInstructions: opts.instructions }) },
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
        if (result.deduplicated > 0) {
          console.log(`⏭️  ${result.deduplicated} skipped (duplicates)`);
        }
        if (result.added.length === 0 && result.updated.length === 0) {
          console.log("No memories extracted from input.");
        }
      });
    });
}
