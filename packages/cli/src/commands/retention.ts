import type { Command } from "commander";
import { loadConfig, createMemory } from "../config.js";

export function registerRetention(program: Command): void {
  program
    .command("retention")
    .description("Scan for expired memories based on retention rules")
    .option("-u, --user <id>", "User ID")
    .option("--delete", "Auto-delete expired memories (default: dry run)")
    .option("--json", "Output as JSON")
    .action(async (opts: { user?: string; delete?: boolean; json?: boolean }) => {
      const config = loadConfig();
      const mem = createMemory(config);
      const userId = opts.user ?? config.userId;

      try {
        const { expired, deleted } = await mem.retentionScanner(userId, {
          autoDelete: opts.delete,
        });

        if (opts.json) {
          console.log(JSON.stringify({ expired, deleted }, null, 2));
          return;
        }

        if (expired.length === 0) {
          console.log("✅ No expired memories found.");
          return;
        }

        console.log(`\n⏰ ${expired.length} expired memories:\n`);
        for (const m of expired) {
          const type = m.memoryType ?? "unknown";
          const date = m.eventDate ?? m.createdAt;
          console.log(`  ${m.id.slice(0, 8)}… [${type}] ${date.slice(0, 10)}`);
          console.log(`  "${m.memory}"`);
          console.log();
        }

        if (opts.delete) {
          console.log(`✅ Deleted ${deleted} expired memories.`);
        } else {
          console.log(`💡 Dry run — use --delete to remove expired memories.`);
        }
      } catch (err) {
        console.error("❌ Retention scan failed:", (err as Error).message);
        process.exit(1);
      }
    });
}
