// @clawmem/openclaw — ClawMem memory-slot plugin for OpenClaw
// Local-first, auditable, reversible memory for OpenClaw agents.

import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { Type } from "@sinclair/typebox";
import { z } from "zod";
import { Memory, buildProfileSummary } from "@clawmem/core";
import type { ConversationMessage } from "@clawmem/core";

// ============================================================================
// Config schema
// ============================================================================

const ClawMemPluginConfigSchema = z.object({
  dataDir: z.string().optional(),
  userId: z.string().default("default"),
  autoRecall: z.boolean().default(true),
  autoCapture: z.boolean().default(true),
  skipGroupChats: z.boolean().default(true),
  searchThreshold: z.number().default(0.3),
  topK: z.number().default(5),
  enableGraph: z.boolean().default(true),
  customInstructions: z.string().optional(),
  identityMapPath: z.string().optional(),
  llm: z.object({
    baseURL: z.string().default("http://127.0.0.1:8080/v1"),
    model: z.string().optional(),
    apiKey: z.string().optional(),
  }).default({}),
  embedder: z.object({
    baseURL: z.string().default("http://127.0.0.1:8082/v1"),
    model: z.string().optional(),
    apiKey: z.string().optional(),
    dimension: z.number().optional(),
  }).default({}),
});

type ClawMemPluginConfig = z.infer<typeof ClawMemPluginConfigSchema>;

// ============================================================================
// Identity mapping
// ============================================================================

interface IdentityMap {
  users: Record<string, { aliases: string[] }>;
}

function loadIdentityMap(filePath: string): IdentityMap {
  if (!existsSync(filePath)) return { users: {} };
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as IdentityMap;
  } catch {
    return { users: {} };
  }
}

function resolveUserId(candidateId: string | undefined, identityMap: IdentityMap, defaultUserId: string): string {
  if (!candidateId) return defaultUserId;
  if (identityMap.users[candidateId]) return candidateId;
  for (const [canonical, data] of Object.entries(identityMap.users)) {
    if (data.aliases?.includes(candidateId)) return canonical;
  }
  return candidateId;
}

function isGroupChat(ctx: unknown): boolean {
  const c = ctx as Record<string, unknown> | null;
  if (!c) return false;
  return c["isGroup"] === true || c["chatType"] === "group" || c["chatType"] === "supergroup";
}

function extractUserFromContext(ctx: unknown, identityMap: IdentityMap, defaultUserId: string): string {
  const c = ctx as Record<string, unknown> | null;
  if (!c) return defaultUserId;
  const candidate = (c["userId"] ?? c["user_id"] ?? (c["from"] ? String(c["from"]) : undefined)) as string | undefined;
  return resolveUserId(candidate, identityMap, defaultUserId);
}

// ============================================================================
// Plugin API type (minimal interface matching OpenClaw plugin SDK)
// ============================================================================

interface PluginApi {
  pluginConfig: unknown;
  logger: {
    info(m: string): void;
    warn(m: string): void;
    debug(m: string): void;
    error(m: string): void;
  };
  resolvePath(p: string): string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerTool(tool: Record<string, any>, meta: Record<string, any>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerCli(fn: (args: { program: any }) => void, meta: Record<string, any>): void;
  on(event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerService(service: Record<string, any>): void;
}

// ============================================================================
// Plugin
// ============================================================================

const clawmemPlugin = {
  id: "clawmem",
  name: "ClawMem",
  description: "ClawMem memory-slot plugin for OpenClaw — local-first, auditable, reversible.",
  kind: "memory" as const,
  configSchema: ClawMemPluginConfigSchema,

  register(api: PluginApi) {
    const rawCfg = api.pluginConfig ?? {};
    const cfg: ClawMemPluginConfig = ClawMemPluginConfigSchema.parse(rawCfg);

    const dataDir = cfg.dataDir ? api.resolvePath(cfg.dataDir) : join(homedir(), ".clawmem");

    const identityMap: IdentityMap = cfg.identityMapPath
      ? loadIdentityMap(api.resolvePath(cfg.identityMapPath))
      : { users: {} };

    function resolveUser(userId?: string, ctx?: unknown): string {
      if (userId) return resolveUserId(userId, identityMap, cfg.userId);
      return extractUserFromContext(ctx, identityMap, cfg.userId);
    }

    const mem = new Memory({
      dataDir,
      llm: { baseURL: cfg.llm.baseURL, ...(cfg.llm.model !== undefined && { model: cfg.llm.model }), ...(cfg.llm.apiKey !== undefined && { apiKey: cfg.llm.apiKey }) },
      embedder: { baseURL: cfg.embedder.baseURL, ...(cfg.embedder.model !== undefined && { model: cfg.embedder.model }), ...(cfg.embedder.apiKey !== undefined && { apiKey: cfg.embedder.apiKey }), ...(cfg.embedder.dimension !== undefined && { dimension: cfg.embedder.dimension }) },
      enableGraph: cfg.enableGraph,
      defaultTopK: cfg.topK,
      dedupThreshold: 0.85,
    });

    api.logger.info(`clawmem: initialized (dataDir=${dataDir}, graph=${cfg.enableGraph})`);

    // -------------------------------------------------------------------------
    // memory_search
    // -------------------------------------------------------------------------
    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description: "Search long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(Type.Number({ description: `Max results (default: ${cfg.topK})` })),
          userId: Type.Optional(Type.String({ description: "User ID override" })),
          category: Type.Optional(Type.String({ description: "Filter by category" })),
          threshold: Type.Optional(Type.Number({ description: "Similarity threshold override (0-1)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { query, limit, userId, category, threshold } = params as {
            query: string; limit?: number; userId?: string; category?: string; threshold?: number;
          };
          try {
            const results = await mem.search(query, {
              userId: resolveUser(userId),
              limit: limit ?? cfg.topK,
              threshold: threshold ?? cfg.searchThreshold,
              category: category as never,
            });
            if (!results?.length) {
              return { content: [{ type: "text", text: "No relevant memories found." }], details: { count: 0 } };
            }
            const text = results
              .map((r, i) => `${i + 1}. ${r.memory} (score: ${((r.score ?? 0) * 100).toFixed(0)}%, id: ${r.id}${r.category ? ` [${r.category}]` : ""})`)
              .join("\n");
            return {
              content: [{ type: "text", text: `Found ${results.length} memories:\n\n${text}` }],
              details: { count: results.length, memories: results.map(r => ({ id: r.id, memory: r.memory, score: r.score, category: r.category })) },
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Memory search failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "memory_search" },
    );

    // -------------------------------------------------------------------------
    // memory_store
    // -------------------------------------------------------------------------
    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description: "Store information in long-term memory. ClawMem automatically extracts and deduplicates key facts from the input.",
        parameters: Type.Object({
          content: Type.String({ description: "Text or conversation to extract memories from" }),
          userId: Type.Optional(Type.String()),
          customInstructions: Type.Optional(Type.String()),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { content, userId, customInstructions } = params as {
            content: string; userId?: string; customInstructions?: string;
          };
          try {
              const effInstructions = customInstructions ?? cfg.customInstructions;
            const result = await mem.add(
              [{ role: "user", content }],
              { userId: resolveUser(userId), ...(effInstructions !== undefined && { customInstructions: effInstructions }) },
            );
            const total = result.added.length + result.updated.length;
            const parts: string[] = [];
            if (result.added.length > 0) parts.push(`Added: ${result.added.map(m => m.memory).join("; ")}`);
            if (result.updated.length > 0) parts.push(`Updated: ${result.updated.map(m => m.memory).join("; ")}`);
            if (result.deduplicated > 0) parts.push(`Skipped ${result.deduplicated} duplicate(s)`);
            return {
              content: [{ type: "text", text: total > 0 ? `Stored ${total} memory/memories. ${parts.join(" | ")}` : "No new information to store." }],
              details: result,
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Memory store failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "memory_store" },
    );

    // -------------------------------------------------------------------------
    // memory_store_raw
    // -------------------------------------------------------------------------
    api.registerTool(
      {
        name: "memory_store_raw",
        label: "Memory Store Raw",
        description: "Store a fact verbatim in long-term memory — no LLM extraction, exactly as written.",
        parameters: Type.Object({
          memory: Type.String({ description: "Exact text to store" }),
          userId: Type.Optional(Type.String()),
          category: Type.Optional(Type.String()),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { memory, userId, category } = params as { memory: string; userId?: string; category?: string };
          try {
            const result = await mem.add(
              [{ role: "user", content: memory }],
              {
                userId: resolveUser(userId),
                customInstructions: `STORE VERBATIM: Store this exact text as a single memory without paraphrasing. Category: ${category ?? "other"}.`,
              },
            );
            const m = result.added[0] ?? result.updated[0];
            if (m) {
              return { content: [{ type: "text", text: `Stored: "${m.memory}" (id: ${m.id})` }], details: { id: m.id } };
            }
            return { content: [{ type: "text", text: "Duplicate — already exists." }], details: {} };
          } catch (err) {
            return { content: [{ type: "text", text: `Store raw failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "memory_store_raw" },
    );

    // -------------------------------------------------------------------------
    // memory_list
    // -------------------------------------------------------------------------
    api.registerTool(
      {
        name: "memory_list",
        label: "Memory List",
        description: "List all stored memories for a user.",
        parameters: Type.Object({
          userId: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Number()),
          category: Type.Optional(Type.String()),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { userId, limit, category } = params as { userId?: string; limit?: number; category?: string };
          try {
            const memories = await mem.getAll({ userId: resolveUser(userId), limit: limit ?? 50, category: category as never });
            if (!memories.length) {
              return { content: [{ type: "text", text: "No memories found." }], details: { count: 0 } };
            }
            const text = memories.map((m, i) => `${i + 1}. [${m.id.slice(0, 8)}] ${m.memory}${m.category ? ` (${m.category})` : ""}`).join("\n");
            return { content: [{ type: "text", text: `${memories.length} memories:\n\n${text}` }], details: { count: memories.length, memories } };
          } catch (err) {
            return { content: [{ type: "text", text: `Memory list failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "memory_list" },
    );

    // -------------------------------------------------------------------------
    // memory_get
    // -------------------------------------------------------------------------
    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get",
        description: "Get a specific memory by ID.",
        parameters: Type.Object({ id: Type.String() }),
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            const m = await mem.get(params["id"] as string);
            if (!m) return { content: [{ type: "text", text: `Memory not found: ${params["id"]}` }], details: {} };
            return { content: [{ type: "text", text: m.memory }], details: m };
          } catch (err) {
            return { content: [{ type: "text", text: `Memory get failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "memory_get" },
    );

    // -------------------------------------------------------------------------
    // memory_forget
    // -------------------------------------------------------------------------
    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description: 'Delete a memory by ID, or pass "all" to wipe all memories for a user.',
        parameters: Type.Object({
          id: Type.String({ description: 'Memory ID or "all"' }),
          userId: Type.Optional(Type.String()),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { id, userId } = params as { id: string; userId?: string };
          try {
            if (id === "all") {
              const u = resolveUser(userId);
              await mem.deleteAll(u);
              return { content: [{ type: "text", text: `All memories deleted for user "${u}".` }], details: { userId: u } };
            }
            const existing = await mem.get(id);
            if (!existing) return { content: [{ type: "text", text: `Memory not found: ${id}` }], details: {} };
            await mem.delete(id);
            return { content: [{ type: "text", text: `Deleted: "${existing.memory}"` }], details: { id } };
          } catch (err) {
            return { content: [{ type: "text", text: `Memory forget failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "memory_forget" },
    );

    // -------------------------------------------------------------------------
    // memory_profile
    // -------------------------------------------------------------------------
    api.registerTool(
      {
        name: "memory_profile",
        label: "Memory Profile",
        description: "Generate a structured user profile from stored memories (identity, preferences, skills, goals, projects).",
        parameters: Type.Object({ userId: Type.Optional(Type.String()) }),
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            const profile = await mem.profile(resolveUser(params["userId"] as string | undefined));
            const summary = buildProfileSummary(profile);
            return { content: [{ type: "text", text: summary || "No profile data found." }], details: profile };
          } catch (err) {
            return { content: [{ type: "text", text: `Profile failed: ${String(err)}` }], details: { error: String(err) } };
          }
        },
      },
      { name: "memory_profile" },
    );

    // =========================================================================
    // Auto-recall hook
    // =========================================================================
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event: unknown, ctx: unknown) => {
        const e = event as { prompt?: string };
        if (!e.prompt || e.prompt.length < 5) return;
        if (cfg.skipGroupChats && isGroupChat(ctx)) {
          api.logger.debug("clawmem: skipping group chat recall");
          return;
        }
        const userId = extractUserFromContext(ctx, identityMap, cfg.userId);
        try {
          const results = await mem.search(e.prompt, { userId, limit: cfg.topK, threshold: cfg.searchThreshold });
          if (!results?.length) return;
          const memoryContext = results.map(r => `- ${r.memory}${r.category ? ` [${r.category}]` : ""}`).join("\n");
          api.logger.info(`clawmem: injecting ${results.length} memories into context`);
          return {
            prependContext: `<relevant-memories>\nThe following memories may be relevant to this conversation:\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (err) {
          api.logger.warn(`clawmem: recall failed: ${String(err)}`);
        }
      });
    }

    // =========================================================================
    // Auto-capture hook
    // =========================================================================
    if (cfg.autoCapture) {
      api.on("agent_end", async (event: unknown, ctx: unknown) => {
        const e = event as { success?: boolean; messages?: Array<{ role: string; content: string }> };
        if (!e.success || !e.messages?.length) return;
        if (cfg.skipGroupChats && isGroupChat(ctx)) {
          api.logger.debug("clawmem: skipping group chat capture");
          return;
        }
        const userId = extractUserFromContext(ctx, identityMap, cfg.userId);
        const humanMessages = e.messages.filter(m => m.role === "user" || m.role === "human").slice(-3);
        if (!humanMessages.length) return;
        try {
          const messages: ConversationMessage[] = humanMessages.map(m => ({ role: "user" as const, content: m.content }));
          const result = await mem.add(messages, { userId, ...(cfg.customInstructions !== undefined && { customInstructions: cfg.customInstructions }) });
          const total = result.added.length + result.updated.length;
          if (total > 0) api.logger.info(`clawmem: captured ${total} memory/memories`);
        } catch (err) {
          api.logger.warn(`clawmem: capture failed: ${String(err)}`);
        }
      });
    }

    // =========================================================================
    // Plugin CLI
    // =========================================================================
    api.registerCli(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ program }: { program: any }) => {
        const cmd = program.command("clawmem").description("ClawMem memory plugin commands");

        cmd
          .command("search <query>")
          .description("Search memories")
          .option("--limit <n>", "Max results", String(cfg.topK))
          .option("--user <id>", "User ID")
          .option("--category <cat>", "Filter by category")
          .action(async (query: string, opts: { limit: string; user?: string; category?: string }) => {
            const results = await mem.search(query, {
              userId: resolveUser(opts.user),
              limit: parseInt(opts.limit, 10),
              threshold: cfg.searchThreshold,
              category: opts.category as never,
            });
            if (!results.length) { console.log("No memories found."); return; }
            console.log(JSON.stringify(results.map(r => ({ id: r.id, memory: r.memory, score: r.score, category: r.category })), null, 2));
          });

        cmd
          .command("status")
          .description("Show ClawMem statistics")
          .option("--user <id>", "User ID")
          .action(async (opts: { user?: string }) => {
            const userId = resolveUser(opts.user);
            const all = await mem.getAll({ userId });
            console.log(`ClawMem status:`);
            console.log(`  Data dir:     ${dataDir}`);
            console.log(`  User:         ${userId}`);
            console.log(`  Memories:     ${all.length}`);
            console.log(`  Graph:        ${cfg.enableGraph ? "enabled" : "disabled"}`);
            console.log(`  Auto-recall:  ${cfg.autoRecall}`);
            console.log(`  Auto-capture: ${cfg.autoCapture}`);
          });

        cmd
          .command("wipe")
          .description("Delete all memories for a user")
          .option("--user <id>", "User ID")
          .option("--yes", "Skip confirmation")
          .action(async (opts: { user?: string; yes?: boolean }) => {
            if (!opts.yes) {
              const { createInterface } = await import("readline");
              const rl = createInterface({ input: process.stdin, output: process.stdout });
              const answer = await new Promise<string>((resolve) =>
                rl.question(`⚠️  Delete ALL memories for user "${resolveUser(opts.user)}"? (yes/no): `, resolve),
              );
              rl.close();
              if (answer.toLowerCase() !== "yes") { console.log("Cancelled."); return; }
            }
            await mem.deleteAll(resolveUser(opts.user));
            console.log("✅ All memories wiped.");
          });

        cmd
          .command("profile")
          .description("Show user profile summary")
          .option("--user <id>", "User ID")
          .action(async (opts: { user?: string }) => {
            const profile = await mem.profile(resolveUser(opts.user));
            console.log(buildProfileSummary(profile));
          });

        cmd
          .command("export")
          .description("Export memories to markdown files")
          .option("--user <id>", "User ID")
          .option("--output <dir>", "Output directory", `${dataDir}/export`)
          .action(async (opts: { user?: string; output: string }) => {
            const written = await mem.exportMarkdown(resolveUser(opts.user), opts.output);
            console.log(`✅ Exported ${written.length} file(s) to ${opts.output}`);
            for (const f of written) console.log(`   ${f}`);
          });

        cmd
          .command("import <file>")
          .description("Import memories from a markdown file")
          .option("--user <id>", "User ID")
          .action(async (file: string, opts: { user?: string }) => {
            const result = await mem.importMarkdown(file, resolveUser(opts.user));
            console.log(`✅ Import: +${result.added} added, ${result.updated} updated, ${result.skipped} skipped`);
          });
      },
      { commands: ["clawmem"] },
    );

    // =========================================================================
    // Service lifecycle
    // =========================================================================
    api.registerService({
      id: "clawmem",
      async start() { api.logger.info("clawmem: plugin started"); },
      async stop() { api.logger.info("clawmem: plugin stopped"); },
    });
  },
};

export default clawmemPlugin;
