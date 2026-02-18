import type { Command } from "commander";
import { withMemory } from "../command-base.js";

export function registerForget(program: Command): void {
  program
    .command("forget <id>")
    .description("Delete a memory by ID (or use 'all' to wipe all memories)")
    .option("-u, --user <id>", "User ID")
    .option("-y, --yes", "Skip confirmation")
    .action(async (id: string, opts: { user?: string; yes?: boolean }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        if (id === "all") {
          if (!opts.yes) {
            const { createInterface } = await import("readline");
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise<string>((resolve) =>
              rl.question(`⚠️  Delete ALL memories for user "${userId}"? (yes/no): `, resolve),
            );
            rl.close();
            if (answer.toLowerCase() !== "yes") {
              console.log("Cancelled.");
              return;
            }
          }
          await mem.deleteAll(userId);
          console.log(`✅ All memories deleted for user "${userId}"`);
        } else {
          const existing = await mem.get(id);
          if (!existing) {
            console.error(`❌ Memory not found: ${id}`);
            process.exit(1);
          }
          await mem.delete(id);
          console.log(`✅ Deleted: ${id.slice(0, 8)}…`);
          console.log(`   "${existing.memory}"`);
        }
      });
    });
}
