import fs from 'node:fs';

const lockfiles = [
  'package-lock.json',
  'backend/package-lock.json',
  'web/package-lock.json',
];

const allowedPrefixes = [
  'https://registry.npmjs.org/',
  'file:',
];

const failures = [];

for (const lockfile of lockfiles) {
  if (!fs.existsSync(lockfile)) {
    failures.push(`${lockfile}: missing lockfile`);
    continue;
  }

  const lock = JSON.parse(fs.readFileSync(lockfile, 'utf8'));
  for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
    const resolved = metadata?.resolved;
    if (!resolved) {
      continue;
    }

    if (!allowedPrefixes.some((prefix) => resolved.startsWith(prefix))) {
      failures.push(`${lockfile}:${packagePath || '<root>'} -> ${resolved}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Unexpected package-lock source entries found:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('All npm lockfile sources resolve to the public npm registry or local file references.');
