import type { Command } from "commander";
import { withMemory } from "../command-base.js";

export function registerHistory(program: Command): void {
  program
    .command("history <memoryId>")
    .description("Show version history for a memory (full audit trail)")
    .option("--json", "Output as JSON")
    .action(async (memoryId: string, opts: { json?: boolean }) => {
      await withMemory(opts as { user?: string }, async ({ mem }) => {
        const entries = await mem.history(memoryId);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }

        if (entries.length === 0) {
          console.log(`No history found for memory ${memoryId}`);
          return;
        }

        console.log(`\n📜 History for ${memoryId.slice(0, 8)}… (${entries.length} entries)\n`);
        for (const e of entries) {
          console.log(`  ${e.createdAt.slice(0, 19)}  ${e.action.toUpperCase()}`);
          if (e.previousValue) console.log(`    was: "${e.previousValue}"`);
          if (e.newValue) console.log(`    now: "${e.newValue}"`);
          console.log();
        }
      });
    });
}
