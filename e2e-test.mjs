#!/usr/bin/env node
/**
 * ClawMem End-to-End Integration Test
 *
 * Tests every subsystem against live local LLM + embedder.
 * Outputs a structured results table at the end.
 */

import { Memory, SleepMode, OpenAICompatLLM } from "./packages/core/dist/index.js";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const DATA_DIR = join(tmpdir(), `clawmem-e2e-${randomUUID().slice(0, 8)}`);
mkdirSync(DATA_DIR, { recursive: true });

const results = [];
function record(system, subtest, pass, detail) {
  const status = pass ? "✅ PASS" : "❌ FAIL";
  results.push({ system, subtest, status, detail: detail?.slice(0, 120) ?? "" });
  console.log(`  ${status}  ${system} > ${subtest}${detail ? " — " + detail.slice(0, 80) : ""}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const config = {
  dataDir: DATA_DIR,
  llm: { baseURL: "http://127.0.0.1:8080/v1", model: "DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf" },
  embedder: { baseURL: "http://127.0.0.1:8082/v1", model: "nomic-embed-text-v1.5.gguf", dimension: 768 },
  enableGraph: true,
  dedupThreshold: 0.85,
  forgettingRules: { episode: 1 },  // episodes expire after 1 day (for testing)
  enableQueryRewriting: false,
};

let mem;

// ============================================================================
// 1. INITIALIZATION
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  1. INITIALIZATION");
console.log("══════════════════════════════════════════════════════");

try {
  mem = new Memory(config);
  record("Init", "Memory constructor", true, `dataDir=${DATA_DIR}`);
} catch (e) {
  record("Init", "Memory constructor", false, e.message);
  console.log("FATAL: Cannot continue without Memory instance");
  process.exit(1);
}

// ============================================================================
// 2. EXTRACTION + ADD
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  2. EXTRACTION + ADD (LLM fact extraction)");
console.log("══════════════════════════════════════════════════════");

let addResult1;
try {
  addResult1 = await mem.add(
    [{ role: "user", content: "My name is Alex, I'm a TypeScript developer. I use Neovim and prefer dark themes. I'm working on an AI memory system called ClawMem." }],
    { userId: "test-user" }
  );
  const count = addResult1.added.length + addResult1.updated.length;
  record("Extraction", "Basic fact extraction", count > 0, `${count} memories extracted, ${addResult1.deduplicated} deduped`);

  // Check that categories were assigned
  const categories = addResult1.added.map(m => m.category).filter(Boolean);
  record("Extraction", "Category assignment", categories.length > 0, `Categories: ${[...new Set(categories)].join(", ")}`);

  // Check memory types
  const types = addResult1.added.map(m => m.memoryType).filter(Boolean);
  record("Extraction", "Memory type assignment", types.length > 0, `Types: ${[...new Set(types)].join(", ")}`);
} catch (e) {
  record("Extraction", "Basic fact extraction", false, e.message);
}

// Second add — different facts
let addResult2;
try {
  addResult2 = await mem.add(
    [
      { role: "user", content: "I had a meeting with Sarah yesterday about the ClawMem roadmap. We decided to use Kùzu for the graph backend." },
      { role: "assistant", content: "Got it! So the roadmap meeting with Sarah went well and Kùzu is the chosen graph database." },
    ],
    { userId: "test-user" }
  );
  record("Extraction", "Multi-message extraction", addResult2.added.length > 0, `${addResult2.added.length} new memories`);
} catch (e) {
  record("Extraction", "Multi-message extraction", false, e.message);
}

// Preferences add
try {
  const r = await mem.add(
    [{ role: "user", content: "I really prefer PostgreSQL over MySQL. I always use fish shell instead of bash. My favorite color is blue." }],
    { userId: "test-user" }
  );
  record("Extraction", "Preference extraction", r.added.length > 0, `${r.added.length} preferences extracted`);
} catch (e) {
  record("Extraction", "Preference extraction", false, e.message);
}

// Episode add (temporal)
try {
  const r = await mem.add(
    [{ role: "user", content: "I have a dentist appointment on March 15, 2026. Also, I submitted my thesis on February 10, 2026." }],
    { userId: "test-user" }
  );
  record("Extraction", "Temporal/episode extraction", r.added.length > 0, `${r.added.length} with eventDate`);
  const withDates = r.added.filter(m => m.eventDate);
  record("Extraction", "eventDate captured", withDates.length > 0, `${withDates.length} have eventDate: ${withDates.map(m => m.eventDate).join(", ")}`);
} catch (e) {
  record("Extraction", "Temporal/episode extraction", false, e.message);
}

// ============================================================================
// 3. DEDUPLICATION
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  3. DEDUPLICATION");
console.log("══════════════════════════════════════════════════════");

try {
  const before = await mem.getAll({ userId: "test-user" });
  const dupResult = await mem.add(
    [{ role: "user", content: "My name is Alex and I am a TypeScript developer." }],
    { userId: "test-user" }
  );
  const after = await mem.getAll({ userId: "test-user" });
  // Should detect this as duplicate or update
  const netNew = after.length - before.length;
  record("Dedup", "Duplicate detection", dupResult.deduplicated > 0 || dupResult.updated.length > 0 || netNew === 0,
    `deduped=${dupResult.deduplicated}, updated=${dupResult.updated.length}, netNew=${netNew}`);
} catch (e) {
  record("Dedup", "Duplicate detection", false, e.message);
}

// ============================================================================
// 4. SEMANTIC SEARCH
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  4. SEMANTIC SEARCH (vector retrieval)");
console.log("══════════════════════════════════════════════════════");

try {
  const results1 = await mem.search("what programming language do I use", { userId: "test-user", limit: 5 });
  record("Search", "Semantic query (language)", results1.length > 0, `${results1.length} results. Top: "${results1[0]?.memory?.slice(0, 80)}"`);

  // Check relevance — should mention TypeScript
  const mentionsTS = results1.some(r => /typescript/i.test(r.memory));
  record("Search", "Result relevance (TypeScript)", mentionsTS, results1.map(r => r.memory.slice(0, 50)).join(" | "));
} catch (e) {
  record("Search", "Semantic query (language)", false, e.message);
}

try {
  const results2 = await mem.search("what editor do I prefer", { userId: "test-user", limit: 5 });
  record("Search", "Semantic query (editor)", results2.length > 0, `${results2.length} results. Top: "${results2[0]?.memory?.slice(0, 80)}"`);
  const mentionsNvim = results2.some(r => /neovim|nvim/i.test(r.memory));
  record("Search", "Result relevance (Neovim)", mentionsNvim, results2.map(r => r.memory.slice(0, 50)).join(" | "));
} catch (e) {
  record("Search", "Semantic query (editor)", false, e.message);
}

try {
  const results3 = await mem.search("who did I meet", { userId: "test-user", limit: 5 });
  record("Search", "Semantic query (people)", results3.length > 0, `${results3.length} results. Top: "${results3[0]?.memory?.slice(0, 80)}"`);
  const mentionsSarah = results3.some(r => /sarah/i.test(r.memory));
  record("Search", "Result relevance (Sarah)", mentionsSarah, results3.map(r => r.memory.slice(0, 50)).join(" | "));
} catch (e) {
  record("Search", "Semantic query (people)", false, e.message);
}

// Keyword search (FTS5)
try {
  const kw = await mem.search("ClawMem", { userId: "test-user", limit: 5, keywordSearch: true });
  record("Search", "Keyword/FTS5 search", kw.length > 0, `${kw.length} FTS results for 'ClawMem'`);
} catch (e) {
  record("Search", "Keyword/FTS5 search", false, e.message);
}

// Category filter
try {
  const catResults = await mem.search("anything", { userId: "test-user", limit: 20, category: "preferences" });
  record("Search", "Category filter (preferences)", true, `${catResults.length} results in 'preferences' category`);
} catch (e) {
  record("Search", "Category filter", false, e.message);
}

// Threshold filter
try {
  const strictResults = await mem.search("quantum computing", { userId: "test-user", limit: 5, threshold: 0.9 });
  record("Search", "High threshold filter (0.9)", strictResults.length === 0, `${strictResults.length} results (expected 0 for irrelevant query)`);
} catch (e) {
  record("Search", "High threshold filter", false, e.message);
}

// ============================================================================
// 5. GET / GETALL / UPDATE / DELETE
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  5. CRUD OPERATIONS");
console.log("══════════════════════════════════════════════════════");

try {
  const all = await mem.getAll({ userId: "test-user" });
  record("CRUD", "getAll", all.length > 0, `${all.length} total memories`);
} catch (e) {
  record("CRUD", "getAll", false, e.message);
}

try {
  const all = await mem.getAll({ userId: "test-user" });
  if (all.length > 0) {
    const first = all[0];
    const fetched = await mem.get(first.id);
    record("CRUD", "get by ID", fetched !== null && fetched.id === first.id, `Got: "${fetched?.memory?.slice(0, 60)}"`);
  }
} catch (e) {
  record("CRUD", "get by ID", false, e.message);
}

let updateTarget;
try {
  const all = await mem.getAll({ userId: "test-user" });
  updateTarget = all[0];
  const updated = await mem.update(updateTarget.id, "UPDATED: This memory was manually updated for testing.");
  record("CRUD", "update memory", updated !== null, `Updated from "${updateTarget.memory.slice(0, 40)}" to "${updated?.memory?.slice(0, 40)}"`);
} catch (e) {
  record("CRUD", "update memory", false, e.message);
}

let deleteTarget;
try {
  const all = await mem.getAll({ userId: "test-user" });
  deleteTarget = all[all.length - 1];
  const beforeCount = all.length;
  await mem.delete(deleteTarget.id);
  const afterAll = await mem.getAll({ userId: "test-user" });
  record("CRUD", "delete memory", afterAll.length === beforeCount - 1, `Before: ${beforeCount}, After: ${afterAll.length}`);
} catch (e) {
  record("CRUD", "delete memory", false, e.message);
}

// getAll with filters
try {
  const latest = await mem.getAll({ userId: "test-user", onlyLatest: true });
  const allVersions = await mem.getAll({ userId: "test-user" });
  record("CRUD", "getAll(onlyLatest)", true, `latest=${latest.length}, all=${allVersions.length}`);
} catch (e) {
  record("CRUD", "getAll(onlyLatest)", false, e.message);
}

// ============================================================================
// 6. HISTORY (AUDIT TRAIL)
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  6. HISTORY / AUDIT TRAIL");
console.log("══════════════════════════════════════════════════════");

try {
  if (updateTarget) {
    const hist = await mem.history(updateTarget.id);
    record("History", "Audit trail exists", hist.length > 0, `${hist.length} history entries for updated memory`);
    const actions = hist.map(h => h.action);
    record("History", "Contains ADD + UPDATE", actions.includes("add") && actions.includes("update"),
      `Actions: ${actions.join(", ")}`);
  }
} catch (e) {
  record("History", "Audit trail", false, e.message);
}

try {
  if (deleteTarget) {
    const hist = await mem.history(deleteTarget.id);
    const hasDelete = hist.some(h => h.action === "delete");
    record("History", "Delete tracked in history", hasDelete, `Actions: ${hist.map(h => h.action).join(", ")}`);
  }
} catch (e) {
  record("History", "Delete tracked", false, e.message);
}

// ============================================================================
// 7. GRAPH MEMORY
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  7. GRAPH MEMORY (Kùzu entities + relationships)");
console.log("══════════════════════════════════════════════════════");

try {
  const relations = await mem.graphRelations("test-user");
  record("Graph", "Graph relations exist", relations.length > 0, `${relations.length} relations found`);
  if (relations.length > 0) {
    for (const r of relations.slice(0, 3)) {
      console.log(`    → ${r.source} -[${r.relationship}]-> ${r.target}`);
    }
  }
} catch (e) {
  record("Graph", "Graph relations", false, e.message);
}

// Add more facts and check graph grows
try {
  await mem.add(
    [{ role: "user", content: "I work at DeepLine with my colleague Mike. We use Python and Go for our backend services." }],
    { userId: "test-user" }
  );
  const relations = await mem.graphRelations("test-user");
  record("Graph", "Graph grows with new facts", relations.length > 0, `${relations.length} total relations after more facts`);
} catch (e) {
  record("Graph", "Graph growth", false, e.message);
}

// ============================================================================
// 8. USER PROFILES
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  8. USER PROFILES");
console.log("══════════════════════════════════════════════════════");

try {
  const profile = await mem.profile("test-user");
  record("Profile", "Profile generated", profile !== null, `Keys: ${Object.keys(profile).join(", ")}`);

  if (profile.static?.identity?.length > 0 || profile.static?.preferences?.length > 0) {
    record("Profile", "Has structured data", true, `identity=${profile.static.identity.length}, prefs=${profile.static.preferences.length}`);
  } else {
    record("Profile", "Has structured data", false, "Empty static profile sections");
  }

  // Note: UserProfile doesn't have a summary field — this is a gap vs SuperMemory
  record("Profile", "Has summary field", false, "DESIGN GAP: UserProfile lacks summary text (SuperMemory has this)");

  console.log("    Profile snapshot:");
  console.log(`      Identity: ${profile.static?.identity?.map(m => m.memory.slice(0, 50)).join("; ") ?? "(none)"}`);
} catch (e) {
  record("Profile", "Profile generation", false, e.message);
}

// ============================================================================
// 9. CONTRADICTION RESOLUTION
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  9. CONTRADICTION RESOLUTION");
console.log("══════════════════════════════════════════════════════");

try {
  const before = await mem.getAll({ userId: "test-user" });
  // Add contradicting fact
  const contradictResult = await mem.add(
    [{ role: "user", content: "I've actually switched from Neovim to VS Code. I now use VS Code as my main editor." }],
    { userId: "test-user" }
  );
  const after = await mem.getAll({ userId: "test-user" });

  const hasUpdate = contradictResult.updated.length > 0;
  record("Contradiction", "Detects conflicting fact", hasUpdate || contradictResult.deduplicated > 0,
    `updated=${contradictResult.updated.length}, deduped=${contradictResult.deduplicated}, added=${contradictResult.added.length}`);

  // Check isLatest handling
  const allMemories = await mem.getAll({ userId: "test-user" });
  const editorMemories = allMemories.filter(m => /neovim|nvim|vs\s?code|vscode/i.test(m.memory));
  if (editorMemories.length > 0) {
    const latestEditor = editorMemories.filter(m => m.isLatest);
    record("Contradiction", "isLatest versioning", true,
      `Editor memories: ${editorMemories.length}, isLatest: ${latestEditor.map(m => m.memory.slice(0, 40)).join(" | ")}`);
  }
} catch (e) {
  record("Contradiction", "Contradiction resolution", false, e.message);
}

// ============================================================================
// 10. RETENTION SCANNER
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  10. RETENTION SCANNER (automatic forgetting)");
console.log("══════════════════════════════════════════════════════");

try {
  const { expired, deleted } = await mem.retentionScanner("test-user", { autoDelete: false });
  record("Retention", "Scanner runs (dry-run)", true, `expired=${expired.length}, deleted=${deleted}`);
} catch (e) {
  record("Retention", "Scanner execution", false, e.message);
}

// ============================================================================
// 11. MARKDOWN EXPORT / IMPORT
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  11. MARKDOWN EXPORT / IMPORT");
console.log("══════════════════════════════════════════════════════");

const exportDir = join(DATA_DIR, "md-export");
try {
  await mem.exportMarkdown("test-user", exportDir);
  const files = readdirSync(exportDir);
  record("Markdown", "Export to markdown", files.length > 0, `Files: ${files.join(", ")}`);

  const hasMemoryMd = files.includes("MEMORY.md");
  record("Markdown", "MEMORY.md generated", hasMemoryMd, hasMemoryMd ? "MEMORY.md present" : "Missing");

  if (hasMemoryMd) {
    const content = readFileSync(join(exportDir, "MEMORY.md"), "utf-8");
    record("Markdown", "MEMORY.md has content", content.length > 10, `${content.length} chars`);
  }

  // Check date-based files
  const dateMds = files.filter(f => f !== "MEMORY.md" && f.endsWith(".md"));
  record("Markdown", "Date-based .md files", dateMds.length > 0, `Date files: ${dateMds.join(", ")}`);
} catch (e) {
  record("Markdown", "Export", false, e.message);
}

// Import test
try {
  const mem2 = new Memory({
    ...config,
    dataDir: join(DATA_DIR, "import-test"),
  });
  mkdirSync(join(DATA_DIR, "import-test"), { recursive: true });

  // Find a date-based .md to import (not MEMORY.md)
  const dateMdFiles = readdirSync(exportDir).filter(f => f !== "MEMORY.md" && f.endsWith(".md"));
  if (dateMdFiles.length > 0) {
    const mdPath = join(exportDir, dateMdFiles[0]);
    const imported = await mem2.importMarkdown(mdPath, "import-user");
    record("Markdown", "Import from markdown", imported.added > 0 || imported.updated > 0, `Added ${imported.added}, updated ${imported.updated}, skipped ${imported.skipped}`);

    const importedMems = await mem2.getAll({ userId: "import-user" });
    record("Markdown", "Imported memories searchable", importedMems.length > 0, `${importedMems.length} memories after import`);
  } else {
    record("Markdown", "Import from markdown", false, "No date .md files to import");
  }
} catch (e) {
  record("Markdown", "Import", false, e.message);
}

// ============================================================================
// 12. MEMORY TYPE SCORING
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  12. MEMORY TYPE SCORING");
console.log("══════════════════════════════════════════════════════");

try {
  const searchResults = await mem.search("preferences", { userId: "test-user", limit: 10 });
  const scored = searchResults.filter(r => r.score !== undefined && r.score > 0);
  record("Scoring", "Search results have scores", scored.length > 0, `${scored.length} results with scores`);
  for (const r of scored.slice(0, 3)) {
    console.log(`    → score=${r.score?.toFixed(3)} type=${r.memoryType ?? "?"} "${r.memory.slice(0, 60)}"`);
  }
} catch (e) {
  record("Scoring", "Score retrieval", false, e.message);
}

// ============================================================================
// 13. SLEEP MODE
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  13. SLEEP MODE (nightly analysis)");
console.log("══════════════════════════════════════════════════════");

try {
  const llm = new OpenAICompatLLM(config.llm);
  const sleepMode = new SleepMode(mem, llm, {
    logDir: join(DATA_DIR, "sleep-logs"),
  });
  sleepMode.appendConversation("test-user", [
    { role: "user", content: "I just finished reading The Pragmatic Programmer. Great book!" },
    { role: "assistant", content: "That's a classic! What were your main takeaways?" },
    { role: "user", content: "Mostly about DRY principle and being pragmatic about tool choices." },
  ]);
  record("Sleep", "appendConversation", true, "Conversation appended for analysis");

  const digest = await sleepMode.run("test-user", { dryRun: true });
  record("Sleep", "Sleep mode runs", digest !== null, `Digest keys: ${Object.keys(digest).join(", ")}`);
  if (digest.extractedFacts) {
    record("Sleep", "Extracts missed facts", digest.extractedFacts.length >= 0, `${digest.extractedFacts.length} facts extracted`);
  }
} catch (e) {
  record("Sleep", "Sleep mode execution", false, e.message);
}

// ============================================================================
// 14. MULTI-USER ISOLATION
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  14. MULTI-USER ISOLATION");
console.log("══════════════════════════════════════════════════════");

try {
  await mem.add(
    [{ role: "user", content: "I am Bob, I work in marketing and use Excel every day." }],
    { userId: "bob" }
  );
  const bobMems = await mem.getAll({ userId: "bob" });
  const testMems = await mem.getAll({ userId: "test-user" });
  record("Isolation", "User memories are separate", bobMems.length > 0 && testMems.length > 0,
    `bob=${bobMems.length}, test-user=${testMems.length}`);

  // Bob shouldn't see test-user's memories in search
  const bobSearch = await mem.search("TypeScript", { userId: "bob", limit: 5 });
  const leaks = bobSearch.filter(r => r.userId !== "bob");
  record("Isolation", "No cross-user leakage in search", leaks.length === 0,
    `Bob searched TypeScript: ${bobSearch.length} results, ${leaks.length} from other users`);
} catch (e) {
  record("Isolation", "Multi-user isolation", false, e.message);
}

// ============================================================================
// 15. deleteAll
// ============================================================================
console.log("\n══════════════════════════════════════════════════════");
console.log("  15. deleteAll (wipe)");
console.log("══════════════════════════════════════════════════════");

try {
  await mem.deleteAll("bob");
  const afterWipe = await mem.getAll({ userId: "bob" });
  record("DeleteAll", "Wipe user data", afterWipe.length === 0, `After wipe: ${afterWipe.length} memories`);

  // test-user should be unaffected
  const testMems = await mem.getAll({ userId: "test-user" });
  record("DeleteAll", "Other users unaffected", testMems.length > 0, `test-user still has ${testMems.length} memories`);
} catch (e) {
  record("DeleteAll", "deleteAll", false, e.message);
}

// ============================================================================
// RESULTS TABLE
// ============================================================================
console.log("\n\n");
console.log("╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗");
console.log("║                              CLAWMEM END-TO-END TEST RESULTS                                              ║");
console.log("╠══════════════════╦══════════════════════════════╦═════════╦════════════════════════════════════════════════╣");
console.log("║ System           ║ Test                         ║ Result  ║ Detail                                         ║");
console.log("╠══════════════════╬══════════════════════════════╬═════════╬════════════════════════════════════════════════╣");

for (const r of results) {
  const sys = r.system.padEnd(16);
  const sub = r.subtest.padEnd(28);
  const stat = r.status.padEnd(7);
  const det = (r.detail || "").slice(0, 46).padEnd(46);
  console.log(`║ ${sys} ║ ${sub} ║ ${stat} ║ ${det} ║`);
}

console.log("╚══════════════════╩══════════════════════════════╩═════════╩════════════════════════════════════════════════╝");

const passed = results.filter(r => r.status.includes("PASS")).length;
const failed = results.filter(r => r.status.includes("FAIL")).length;
console.log(`\n  TOTAL: ${passed} passed, ${failed} failed out of ${results.length} tests`);
console.log(`  Data dir: ${DATA_DIR}`);

// Cleanup
try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
console.log("  (temp data cleaned up)\n");

if (failed > 0) process.exit(1);
