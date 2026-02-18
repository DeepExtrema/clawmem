import type { Command } from "commander";
import { withMemory } from "../command-base.js";

const DEFAULT_RELATION_LIMIT = 50;
const DEFAULT_ENTITY_LIMIT = 100;
const MAX_LIMIT = 500;

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  flagName: string,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return Math.min(parsed, MAX_LIMIT);
}

function parseOffset(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("--offset must be a non-negative integer");
  }
  return parsed;
}

function printRelations(
  title: string,
  relations: Array<{ sourceName: string; relationship: string; targetName: string }>,
): void {
  if (relations.length === 0) {
    console.log("No graph relationships found.");
    return;
  }
  console.log(`\n${title}\n`);
  for (const r of relations) {
    console.log(`  ${r.sourceName} —[${r.relationship}]→ ${r.targetName}`);
  }
  console.log();
}

function printEntities(
  entities: Array<{ name: string; relationCount: number }>,
): void {
  if (entities.length === 0) {
    console.log("No entities found.");
    return;
  }
  console.log(`\n🔵 ${entities.length} entity/entities:\n`);
  for (const e of entities) {
    console.log(
      `  ${e.name} (${e.relationCount} relation${e.relationCount !== 1 ? "s" : ""})`,
    );
  }
  console.log();
}

export function registerGraph(program: Command): void {
  const graph = program
    .command("graph")
    .description("Inspect the knowledge graph");

  graph
    .command("relations")
    .description("List all entity relationships")
    .option("-u, --user <id>", "User ID")
    .option("-n, --limit <n>", "Max results", "50")
    .option("-o, --offset <n>", "Pagination offset", "0")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      user?: string;
      limit?: string;
      offset?: string;
      json?: boolean;
    }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const limit = parsePositiveInt(opts.limit, DEFAULT_RELATION_LIMIT, "--limit");
        const offset = parseOffset(opts.offset);
        const relations = await mem.graphRelations(userId, { limit, offset });

        if (opts.json) {
          console.log(JSON.stringify(relations, null, 2));
          return;
        }
        printRelations(`🕸️  ${relations.length} relationship(s):`, relations);
      });
    });

  graph
    .command("entities")
    .description("List unique entities in the graph")
    .option("-u, --user <id>", "User ID")
    .option("-n, --limit <n>", "Max entities", "100")
    .option("-o, --offset <n>", "Pagination offset", "0")
    .option("-q, --query <text>", "Filter entity names")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      user?: string;
      limit?: string;
      offset?: string;
      query?: string;
      json?: boolean;
    }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const limit = parsePositiveInt(opts.limit, DEFAULT_ENTITY_LIMIT, "--limit");
        const offset = parseOffset(opts.offset);
        const entities = await mem.graphEntities(userId, {
          ...(opts.query !== undefined && { query: opts.query }),
          limit,
          offset,
        });

        if (opts.json) {
          console.log(JSON.stringify(entities, null, 2));
          return;
        }
        printEntities(entities);
      });
    });

  graph
    .command("search <entity>")
    .description("Search for relationships involving an entity")
    .option("-u, --user <id>", "User ID")
    .option("-n, --limit <n>", "Max results", "50")
    .option("-o, --offset <n>", "Pagination offset", "0")
    .option("--json", "Output as JSON")
    .action(async (entity: string, opts: {
      user?: string;
      limit?: string;
      offset?: string;
      json?: boolean;
    }) => {
      await withMemory(opts, async ({ mem, userId }) => {
        const limit = parsePositiveInt(opts.limit, DEFAULT_RELATION_LIMIT, "--limit");
        const offset = parseOffset(opts.offset);
        const matches = await mem.graphSearch(entity, userId, { limit, offset });

        if (opts.json) {
          console.log(JSON.stringify(matches, null, 2));
          return;
        }

        if (matches.length === 0) {
          console.log(`No relationships found for "${entity}".`);
          return;
        }

        printRelations(
          `🔍 ${matches.length} relationship(s) matching "${entity}":`,
          matches,
        );
      });
    });
}
