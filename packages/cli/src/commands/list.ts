import type { Command } from "commander";
import { withMemory } from "../command-base.js";

export function registerList(program: Command): void {
  program
    .command("list")
    .description("List all memories")
    .option("-u, --user <id>", "User ID")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--category <cat>", "Filter by category")
    .option("--type <type>", "Filter by type: fact|preference|episode")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      user?: string;
      limit: string;
      offset: string;
      category?: string;
      type?: string;
      json?: boolean;
    }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const memories = await mem.getAll({
          userId,
          limit: parseInt(opts.limit, 10),
          offset: parseInt(opts.offset, 10),
          category: opts.category as never,
          memoryType: opts.type as never,
        });

        if (opts.json) {
          console.log(JSON.stringify(memories, null, 2));
          return;
        }

        if (memories.length === 0) {
          console.log("No memories found.");
          return;
        }

        console.log(`\n📋 ${memories.length} memories for "${userId}":\n`);
        for (const m of memories) {
          const cat = m.category ? ` [${m.category}]` : "";
          const type = m.memoryType ? ` (${m.memoryType})` : "";
          const latest = m.isLatest ? "" : " ⚠️ superseded";
          console.log(`  ${m.id.slice(0, 8)}…${cat}${type}${latest}`);
          console.log(`  ${m.memory}`);
          console.log(`  ${m.createdAt.slice(0, 10)}`);
          console.log();
        }
      });
    });
}
