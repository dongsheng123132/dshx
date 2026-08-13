#!/usr/bin/env node

import { main } from "../lib/core.mjs";

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`dshx: ${message}\n`);
  process.exitCode = 1;
});
