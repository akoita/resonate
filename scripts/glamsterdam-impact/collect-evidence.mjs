#!/usr/bin/env node

import { EvidenceError, collectEvidence, RPC_URL_ENV } from "./lib.mjs";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath || process.argv.length !== 4) {
  console.error("usage: node collect-evidence.mjs <sanitized-seed.json> <sanitized-output.json>");
  process.exit(2);
}

try {
  const summary = await collectEvidence(inputPath, outputPath);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (error instanceof EvidenceError) {
    console.error(`Glamsterdam repricing evidence collection rejected: ${error.message}`);
    if (error.path === "rpc" && !process.env[RPC_URL_ENV]) {
      console.error(`Set ${RPC_URL_ENV} only in the environment; never place an RPC URL in evidence.`);
    }
    process.exit(1);
  }
  throw error;
}
