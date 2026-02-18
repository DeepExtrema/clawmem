import type { Command } from "commander";
import { withMemory } from "../command-base.js";
import { buildProfileSummary } from "@clawmem/core";

export function registerProfile(program: Command): void {
  program
    .command("profile")
    .description("Show structured user profile (static + dynamic facts)")
    .option("-u, --user <id>", "User ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { user?: string; json?: boolean }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const profile = await mem.profile(userId);
        const totalCount =
          profile.static.identity.length +
          profile.static.preferences.length +
          profile.static.technical.length +
          profile.static.relationships.length +
          profile.dynamic.goals.length +
          profile.dynamic.projects.length +
          profile.dynamic.lifeEvents.length +
          profile.other.length;

        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
          return;
        }

        if (totalCount === 0) {
          console.log(`No memories found for user "${userId}". Run \`clawmem add\` to get started.`);
          return;
        }

        console.log(`\n👤 Profile for "${userId}" (${totalCount} memories)\n`);
        console.log(buildProfileSummary(profile));
        console.log(`\nGenerated at: ${profile.generatedAt}`);
      });
    });
}
