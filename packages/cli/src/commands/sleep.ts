import type { Command } from "commander";
import { withMemory } from "../command-base.js";
import { SleepMode } from "@clawmem/core";
import { join } from "path";
import { DEFAULT_DATA_DIR } from "../config.js";

export function registerSleep(program: Command): void {
  program
    .command("sleep")
    .description("Run sleep mode analysis — extract missed facts from conversation logs")
    .option("-u, --user <id>", "User ID")
    .option("--date <date>", "Analyze a specific date (YYYY-MM-DD). Default: yesterday")
    .option("--log-dir <dir>", "Conversation log directory", join(DEFAULT_DATA_DIR, "logs"))
    .option("--dry-run", "Show what would be extracted without storing")
    .option("--json", "Output digest as JSON")
    .action(async (opts: {
      user?: string;
      date?: string;
      logDir: string;
      dryRun?: boolean;
      json?: boolean;
    }) => {
      await withMemory(opts, async ({ mem, userId, config }) => {
        // Use the actual LLM from mem — we need to create a SleepMode with the real LLM
        // For now, create a standalone SleepMode with the config endpoints
        const { OpenAICompatLLM } = await import("@clawmem/core");
        const llm = new OpenAICompatLLM(config.llm);
        const sleepWithLlm = new SleepMode(
          { add: mem.add.bind(mem) as never },
          llm,
          { logDir: opts.logDir },
        );

        console.log(`🌙 Running sleep mode analysis for "${userId}"...`);
        if (opts.dryRun) console.log(`   (dry run — no changes will be made)`);

        const digest = await sleepWithLlm.run(userId, {
          ...(opts.date !== undefined && { date: opts.date }),
          ...(opts.dryRun !== undefined && { dryRun: opts.dryRun }),
        });

        if (opts.json) {
          console.log(JSON.stringify(digest, null, 2));
          return;
        }

        console.log(`\n📋 Sleep digest for ${digest.date}:\n`);
        console.log(`  Summary: ${digest.summary}`);
        if (digest.patterns.length > 0) {
          console.log(`\n  Patterns detected:`);
          for (const p of digest.patterns) console.log(`    • ${p}`);
        }
        if (digest.memoriesExtracted > 0 || digest.memoriesUpdated > 0) {
          console.log(`\n  Memories extracted: ${digest.memoriesExtracted}`);
          console.log(`  Memories updated:   ${digest.memoriesUpdated}`);
        }
        if (opts.dryRun) {
          console.log(`\n💡 Dry run complete. Remove --dry-run to persist.`);
        }
      });
    });
}
