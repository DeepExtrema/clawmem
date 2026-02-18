import type { Command } from "commander";
import { withMemory } from "../command-base.js";

export function registerGraph(program: Command): void {
  const graph = program
    .command("graph")
    .description("Inspect the knowledge graph");

  graph
    .command("relations")
    .description("List all entity relationships")
    .option("-u, --user <id>", "User ID")
    .option("-n, --limit <n>", "Max results", "50")
    .option("--json", "Output as JSON")
    .action(async (opts: { user?: string; limit: string; json?: boolean }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const rels = await mem.graphRelations(userId);
        const limited = rels.slice(0, parseInt(opts.limit, 10));

        if (opts.json) {
          console.log(JSON.stringify(limited, null, 2));
          return;
        }

        if (limited.length === 0) {
          console.log("No graph relationships found.");
          return;
        }

        console.log(`\n🕸️  ${limited.length} relationship(s):\n`);
        for (const r of limited) {
          console.log(`  ${r.source} —[${r.relationship}]→ ${r.target}`);
        }
        if (rels.length > limited.length) {
          console.log(`\n  … and ${rels.length - limited.length} more (use --limit)`);
        }
        console.log();
      });
    });

  graph
    .command("entities")
    .description("List unique entities in the graph")
    .option("-u, --user <id>", "User ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { user?: string; json?: boolean }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const rels = await mem.graphRelations(userId);

        // Collect unique entities from source + target fields
        const entities = new Map<string, { name: string; count: number }>();
        for (const r of rels) {
          const src = entities.get(r.source) ?? { name: r.source, count: 0 };
          src.count++;
          entities.set(r.source, src);

          const tgt = entities.get(r.target) ?? { name: r.target, count: 0 };
          tgt.count++;
          entities.set(r.target, tgt);
        }

        const sorted = [...entities.values()].sort((a, b) => b.count - a.count);

        if (opts.json) {
          console.log(JSON.stringify(sorted, null, 2));
          return;
        }

        if (sorted.length === 0) {
          console.log("No entities found.");
          return;
        }

        console.log(`\n🔵 ${sorted.length} entity/entities:\n`);
        for (const e of sorted) {
          console.log(`  ${e.name} (${e.count} relation${e.count !== 1 ? "s" : ""})`);
        }
        console.log();
      });
    });

  graph
    .command("search <entity>")
    .description("Search for relationships involving an entity")
    .option("-u, --user <id>", "User ID")
    .option("--json", "Output as JSON")
    .action(async (entity: string, opts: { user?: string; json?: boolean }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const rels = await mem.graphRelations(userId);
        const needle = entity.toLowerCase();
        const matches = rels.filter(
          (r) =>
            r.source.toLowerCase().includes(needle) ||
            r.target.toLowerCase().includes(needle),
        );

        if (opts.json) {
          console.log(JSON.stringify(matches, null, 2));
          return;
        }

        if (matches.length === 0) {
          console.log(`No relationships found for "${entity}".`);
          return;
        }

        console.log(`\n🔍 ${matches.length} relationship(s) matching "${entity}":\n`);
        for (const r of matches) {
          console.log(`  ${r.source} —[${r.relationship}]→ ${r.target}`);
        }
        console.log();
      });
    });
}
