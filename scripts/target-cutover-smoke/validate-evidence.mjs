#!/usr/bin/env node

import { EvidenceError, loadEvidence } from "./lib.mjs";

const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error("usage: node validate-evidence.mjs <secret-free-evidence.json>");
  process.exit(2);
}

try {
  const summary = await loadEvidence(path);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (error instanceof EvidenceError) {
    console.error(`target cutover evidence rejected: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
