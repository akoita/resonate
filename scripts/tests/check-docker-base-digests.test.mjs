import assert from "node:assert/strict";
import test from "node:test";

import { checkDocuments, inspectDockerfile } from "../check-docker-base-digests.mjs";


const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;


test("accepts digest-pinned bases and excludes internal stages", () => {
  const result = inspectDockerfile(
    `FROM --platform=linux/amd64 node:20-slim@${DIGEST_A} AS Build\nFROM build AS output\nFROM scratch\n`,
    "Dockerfile",
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.inputs, [
    { source: "node:20-slim", digest: DIGEST_A, location: "Dockerfile:1" },
  ]);
});


test("rejects mutable or malformed external bases", () => {
  const result = inspectDockerfile(
    `FROM node:20-slim\nFROM python:3.12@sha256:not-valid\n`,
    "workers/Dockerfile",
  );
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /workers\/Dockerfile:1/u);
  assert.match(result.errors[1], /workers\/Dockerfile:2/u);
});


test("rejects inconsistent digests for the same readable tag", () => {
  const result = checkDocuments([
    ["backend/Dockerfile", `FROM node:20-slim@${DIGEST_A}\n`],
    ["web/Dockerfile", `FROM node:20-slim@${DIGEST_B}\n`],
  ]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /backend\/Dockerfile:1 uses/u);
});
