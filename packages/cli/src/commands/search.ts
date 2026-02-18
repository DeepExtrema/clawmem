import type { Command } from "commander";
import { withMemory } from "../command-base.js";

export function registerSearch(program: Command): void {
  program
    .command("search <query>")
    .description("Search memories semantically")
    .option("-u, --user <id>", "User ID")
    .option("-n, --limit <n>", "Max results", "5")
    .option("-t, --threshold <n>", "Similarity threshold (0-1)", "0.3")
    .option("-k, --keyword", "Enable keyword search (hybrid)")
    .option("--category <cat>", "Filter by category")
    .option("--json", "Output as JSON")
    .action(async (query: string, opts: {
      user?: string;
      limit: string;
      threshold: string;
      keyword?: boolean;
      category?: string;
      json?: boolean;
    }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const results = await mem.search(query, {
          userId,
          limit: parseInt(opts.limit, 10),
          threshold: parseFloat(opts.threshold),
          ...(opts.keyword !== undefined && { keywordSearch: opts.keyword }),
          ...(opts.category !== undefined && { category: opts.category as never }),
        });

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log("No memories found.");
          return;
        }

        console.log(`\n🔍 Found ${results.length} memories for "${query}":\n`);
        for (const r of results) {
          const score = r.score !== undefined ? ` (${(r.score * 100).toFixed(0)}%)` : "";
          const cat = r.category ? ` [${r.category}]` : "";
          console.log(`  ${r.id.slice(0, 8)}…${cat}${score}`);
          console.log(`  ${r.memory}`);
          console.log();
        }
      });
    });
}
