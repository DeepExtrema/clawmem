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

const program = new Command();

program
  .name("clawmem")
  .description(
    "Local-first memory engine — durable, auditable, reversible.\nDocs: https://github.com/tekron/clawmem",
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

program.parse();
