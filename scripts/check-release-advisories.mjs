#!/usr/bin/env node
// Release backstop: fail when a shipped project's production dependencies have
// an open high or critical advisory that is not covered by a reviewed,
// unexpired exception in scripts/release-advisory-exceptions.json.
//
// Merge-time review blocks new vulnerable dependencies; this catches advisories
// published against code that is already on main. See the "Security alert
// triage" section of docs/operations/supply_chain_updates.md.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHIPPED_PROJECTS = Object.freeze(['backend', 'web', 'desktop']);
export const BLOCKING_SEVERITIES = Object.freeze(['high', 'critical']);
const EXCEPTIONS_FILE = path.join(REPOSITORY_ROOT, 'scripts', 'release-advisory-exceptions.json');

// `npm audit --omit=dev --package-lock-only --json` for one project. A
// non-zero exit is expected when advisories exist; only unparseable output is
// an error.
export function auditProject(project, repositoryRoot = REPOSITORY_ROOT) {
  const result = spawnSync(
    'npm',
    ['audit', '--omit=dev', '--package-lock-only', '--json', '--engine-strict=false'],
    { cwd: path.join(repositoryRoot, project), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${project}: npm audit returned no JSON (exit ${result.status}): ${result.stderr.trim()}`);
  }
}

// One finding per (project, package, advisory), from direct advisory entries
// only; transitive "via" strings point back at those entries.
export function blockingFindings(project, report) {
  const findings = [];
  for (const [name, entry] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING_SEVERITIES.includes(via.severity)) {
        continue;
      }
      const ghsa = String(via.url ?? '').split('/').pop();
      findings.push({ project, package: name, ghsa, severity: via.severity, title: via.title ?? '' });
    }
  }
  return findings;
}

export function evaluate(findings, exceptions, today) {
  const failures = [];
  const used = new Set();
  for (const finding of findings) {
    const index = exceptions.findIndex(
      (exception) =>
        exception.ghsa === finding.ghsa &&
        exception.package === finding.package &&
        (exception.projects ?? []).includes(finding.project),
    );
    const exception = exceptions[index];
    const label = `${finding.project}: ${finding.severity} ${finding.package} ${finding.ghsa} (${finding.title})`;
    if (!exception) {
      failures.push(`${label} has no exception`);
    } else if (!(exception.expires >= today)) {
      failures.push(`${label} exception expired on ${exception.expires}`);
    } else {
      used.add(index);
    }
  }
  const stale = exceptions.filter((_, index) => !used.has(index));
  return { failures, stale };
}

export function validateExceptions(exceptions) {
  const problems = [];
  exceptions.forEach((exception, index) => {
    for (const field of ['ghsa', 'package', 'expires', 'reason', 'tracking']) {
      if (typeof exception[field] !== 'string' || exception[field].trim() === '') {
        problems.push(`exception ${index}: missing ${field}`);
      }
    }
    if (!Array.isArray(exception.projects) || exception.projects.length === 0) {
      problems.push(`exception ${index}: missing projects`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires ?? '')) {
      problems.push(`exception ${index}: expires must be YYYY-MM-DD`);
    }
  });
  return problems;
}

function main() {
  const { exceptions = [] } = JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, 'utf8'));
  const problems = validateExceptions(exceptions);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }

  const findings = SHIPPED_PROJECTS.flatMap((project) => blockingFindings(project, auditProject(project)));
  const today = new Date().toISOString().slice(0, 10);
  const { failures, stale } = evaluate(findings, exceptions, today);

  for (const exception of stale) {
    console.log(`::warning::Unused advisory exception ${exception.ghsa} (${exception.package}); remove it.`);
  }
  if (failures.length > 0) {
    console.error('Release blocked by production advisories:');
    console.error(failures.map((failure) => `- ${failure}`).join('\n'));
    console.error('Fix them, or add a reviewed exception with an expiry to scripts/release-advisory-exceptions.json.');
    process.exit(1);
  }
  console.log(`No unexcepted high or critical production advisories in ${SHIPPED_PROJECTS.join(', ')}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
