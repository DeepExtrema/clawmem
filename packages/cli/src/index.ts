#!/usr/bin/env node
import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerSearch } from "./commands/search.js";
import { registerAdd } from "./commands/add.js";
import { registerForget } from "./commands/forget.js";
import { registerProfile } from "./commands/profile.js";
import { registerList } from "./commands/list.js";
import { registerHistory } from "./commands/history.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerExport, registerImport } from "./commands/export-import.js";
import { registerRetention } from "./commands/retention.js";
import { registerSleep } from "./commands/sleep.js";

const program = new Command();

program
  .name("clawmem")
  .description(
    "Local-first memory engine — durable, auditable, reversible.\nDocs: https://github.com/DeepExtrema/clawmem",
  )
  .version("0.1.0");

registerInit(program);
registerSearch(program);
registerAdd(program);
registerForget(program);
registerProfile(program);
registerList(program);
registerHistory(program);
registerDoctor(program);
registerExport(program);
registerImport(program);
registerRetention(program);
registerSleep(program);

program.parse();
