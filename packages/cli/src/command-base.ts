import { Memory } from "@clawmem/core";
import { loadConfig, createMemory, type CliConfig } from "./config.js";

export interface CommandContext {
  mem: Memory;
  userId: string;
  config: CliConfig;
}

/**
 * Standard command wrapper: loads config, creates Memory, resolves userId,
 * and handles errors with consistent formatting.
 */
export async function withMemory(
  opts: { user?: string },
  fn: (ctx: CommandContext) => Promise<void>,
): Promise<void> {
  let mem: Memory | null = null;
  try {
    const config = loadConfig();
    mem = createMemory(config);
    const userId = opts.user ?? config.userId;
    await fn({ mem, userId, config });
  } catch (err) {
    console.error(
      "❌ Error:",
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  } finally {
    if (mem) {
      await mem.close();
    }
  }
}
