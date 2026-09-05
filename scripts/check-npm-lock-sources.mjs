#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { FIRST_PARTY_PROJECTS, REPOSITORY_ROOT } from './npm-lifecycle-policy.mjs';

export const ALLOWED_LOCKFILE_SOURCE_PREFIXES = Object.freeze([
  'https://registry.npmjs.org/',
  'file:',
]);

export function validateNpmLockSources(repositoryRoot = REPOSITORY_ROOT) {
  const failures = [];

  for (const { lockfile } of FIRST_PARTY_PROJECTS) {
    const absoluteLockfile = path.join(repositoryRoot, lockfile);
    if (!fs.existsSync(absoluteLockfile)) {
      failures.push(`${lockfile}: missing lockfile`);
      continue;
    }

    let lock;
    try {
      lock = JSON.parse(fs.readFileSync(absoluteLockfile, 'utf8'));
    } catch (error) {
      failures.push(`${lockfile}: ${error.message}`);
      continue;
    }

    for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
      const resolved = metadata?.resolved;
      if (!resolved) {
        continue;
      }

      if (!ALLOWED_LOCKFILE_SOURCE_PREFIXES.some((prefix) => resolved.startsWith(prefix))) {
        failures.push(`${lockfile}:${packagePath || '<root>'} -> ${resolved}`);
      }
    }
  }

  return failures;
}

export function assertNpmLockSources(repositoryRoot = REPOSITORY_ROOT) {
  const failures = validateNpmLockSources(repositoryRoot);
  if (failures.length > 0) {
    throw new Error(`Unexpected package-lock source entries found:\n- ${failures.join('\n- ')}`);
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    assertNpmLockSources();
    console.log('All first-party npm lockfile sources resolve to the public npm registry or local file references.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
