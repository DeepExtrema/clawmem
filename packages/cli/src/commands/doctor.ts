import type { Command } from "commander";
import { loadConfig, CONFIG_PATH } from "../config.js";
import { existsSync } from "fs";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check ClawMem setup — config, endpoints, storage")
    .action(async () => {
      const config = loadConfig();
      let allGood = true;

      console.log("\n🩺 ClawMem Doctor\n");

      // Config check
      if (existsSync(CONFIG_PATH)) {
        console.log(`✅ Config found: ${CONFIG_PATH}`);
      } else {
        console.log(`⚠️  No config file — using defaults. Run \`clawmem init\` to configure.`);
      }

      // Data dir check
      if (existsSync(config.dataDir)) {
        console.log(`✅ Data directory: ${config.dataDir}`);
      } else {
        console.log(`⚠️  Data directory does not exist: ${config.dataDir}`);
      }

      // LLM check
      console.log(`\n🤖 LLM: ${config.llm.baseURL}`);
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${config.llm.baseURL}/models`, {
          headers: { Authorization: `Bearer ${config.llm.apiKey ?? "local"}` },
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timeout));
        if (res.ok) {
          console.log(`   ✅ Reachable (${res.status})`);
        } else {
          console.log(`   ⚠️  Responded with ${res.status}`);
        }
      } catch {
        console.log(`   ❌ Unreachable — is your LLM server running?`);
        allGood = false;
      }

      // Embedder check
      console.log(`\n🔢 Embedder: ${config.embedder.baseURL}`);
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${config.embedder.baseURL}/models`, {
          headers: { Authorization: `Bearer ${config.embedder.apiKey ?? "local"}` },
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timeout));
        if (res.ok) {
          console.log(`   ✅ Reachable (${res.status})`);
        } else {
          console.log(`   ⚠️  Responded with ${res.status}`);
        }
      } catch {
        console.log(`   ❌ Unreachable — is your embedder running?`);
        allGood = false;
      }

      // DB check
      console.log(`\n💾 Storage`);
      try {
        const { SqliteVecStore } = await import("@clawmem/core");
        const vs = new SqliteVecStore({ dbPath: `${config.dataDir}/vector.db`, dimension: config.embedder.dimension ?? 768 });
        const [items] = await vs.list({}, 1);
        console.log(`   ✅ Vector store OK (${items.length > 0 ? "has data" : "empty"})`);
      } catch (err) {
        console.log(`   ❌ Vector store error: ${(err as Error).message}`);
        allGood = false;
      }

      console.log(allGood ? "\n✅ All checks passed!" : "\n⚠️  Some checks failed — see above.");
      if (!allGood) process.exit(1);
    });
}
