#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


const DIGEST = /^sha256:[0-9a-f]{64}$/;


export function inspectDockerfile(contents, filename) {
  const aliases = new Set();
  const inputs = [];
  const errors = [];
  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    const match = line.match(/^\s*FROM(?:\s+--platform=\S+)?\s+(\S+)(?:\s+AS\s+(\S+))?/iu);
    if (!match) continue;
    const [, image, alias] = match;
    const internal = aliases.has(image.toLowerCase());
    if (alias) aliases.add(alias.toLowerCase());
    if (image.toLowerCase() === "scratch" || internal) continue;

    const [source, digest] = image.includes("@")
      ? [image.slice(0, image.lastIndexOf("@")), image.slice(image.lastIndexOf("@") + 1)]
      : [image, ""];
    const location = `${filename}:${index + 1}`;
    if (!source || !DIGEST.test(digest)) {
      errors.push(`${location}: external FROM must use a sha256 digest: ${image}`);
      continue;
    }
    inputs.push({ source, digest, location });
  }
  return { inputs, errors };
}


export function checkDocuments(documents) {
  const errors = [];
  const reviewed = new Map();
  for (const [filename, contents] of documents) {
    const result = inspectDockerfile(contents, filename);
    errors.push(...result.errors);
    for (const input of result.inputs) {
      const previous = reviewed.get(input.source);
      if (previous && previous.digest !== input.digest) {
        errors.push(
          `${input.location}: ${input.source} uses ${input.digest}, but ${previous.location} uses ${previous.digest}`,
        );
      } else if (!previous) {
        reviewed.set(input.source, input);
      }
    }
  }
  return { errors, inputs: [...reviewed.values()] };
}


function trackedDockerfiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output
    .split("\0")
    .filter(Boolean)
    .filter((filename) => {
      const basename = path.basename(filename);
      return basename === "Dockerfile" || basename.startsWith("Dockerfile.");
    })
    .sort();
}


function main() {
  const documents = trackedDockerfiles().map((filename) => [filename, readFileSync(filename, "utf8")]);
  const result = checkDocuments(documents);
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${result.inputs.length} reviewed Docker base image references.`);
}


if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
