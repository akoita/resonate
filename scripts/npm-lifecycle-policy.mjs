import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const POLICY_PATH = 'scripts/npm-lifecycle-policy.json';
export const INSTALL_LIFECYCLE_NAMES = ['preinstall', 'install', 'postinstall', 'prepare'];
export const FIRST_PARTY_PROJECTS = Object.freeze([
  { project: '.', lockfile: 'package-lock.json' },
  { project: 'backend', lockfile: 'backend/package-lock.json' },
  { project: 'web', lockfile: 'web/package-lock.json' },
  { project: 'desktop', lockfile: 'desktop/package-lock.json' },
  { project: 'scripts/staging-smoke', lockfile: 'scripts/staging-smoke/package-lock.json' },
  { project: 'examples/mcp-client', lockfile: 'examples/mcp-client/package-lock.json' },
]);

export function lifecycleTupleKey(packagePath, version) {
  return `${packagePath}@${version}`;
}

export function readJson(repositoryRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
}

export function loadLifecyclePolicy(repositoryRoot = REPOSITORY_ROOT) {
  return readJson(repositoryRoot, POLICY_PATH);
}

export function lockfileLifecycleTuples(lockfile) {
  return Object.entries(lockfile.packages ?? {})
    .filter(([packagePath, metadata]) => packagePath && metadata?.hasInstallScript)
    .map(([packagePath, metadata]) => ({
      packagePath,
      version: metadata.version,
      dev: metadata.dev === true,
      optional: metadata.optional === true,
      key: lifecycleTupleKey(packagePath, metadata.version),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function validateDecision(decision, context, errors) {
  if (!decision || !['execute', 'deny'].includes(decision.disposition)) {
    errors.push(`${context}: disposition must be "execute" or "deny"`);
  }
  if (typeof decision?.rationale !== 'string' || decision.rationale.trim() === '') {
    errors.push(`${context}: rationale must be a non-empty string`);
  }
  if (decision?.executionOrder !== undefined
    && (!Number.isSafeInteger(decision.executionOrder) || decision.executionOrder < 0)) {
    errors.push(`${context}: executionOrder must be a non-negative safe integer`);
  }
}

export function validateLifecyclePolicy({ repositoryRoot = REPOSITORY_ROOT, policy = loadLifecyclePolicy(repositoryRoot) } = {}) {
  const errors = [];

  if (policy?.schemaVersion !== 1) {
    errors.push(`${POLICY_PATH}: unsupported schemaVersion ${JSON.stringify(policy?.schemaVersion)}`);
  }

  const expectedProjects = new Map(FIRST_PARTY_PROJECTS.map((entry) => [entry.project, entry.lockfile]));
  const policyProjects = policy?.projects ?? {};

  for (const project of Object.keys(policyProjects)) {
    if (!expectedProjects.has(project)) {
      errors.push(`${POLICY_PATH}: stale or unknown project ${JSON.stringify(project)}`);
    }
  }

  for (const [project, lockfilePath] of expectedProjects) {
    const projectPolicy = policyProjects[project];
    if (!projectPolicy) {
      errors.push(`${POLICY_PATH}: missing first-party project ${JSON.stringify(project)}`);
      continue;
    }
    if (projectPolicy.lockfile !== lockfilePath) {
      errors.push(`${project}: policy lockfile ${JSON.stringify(projectPolicy.lockfile)} does not match ${JSON.stringify(lockfilePath)}`);
      continue;
    }

    let lockfile;
    let packageJson;
    try {
      lockfile = readJson(repositoryRoot, lockfilePath);
    } catch (error) {
      errors.push(`${lockfilePath}: ${error.message}`);
      continue;
    }
    try {
      packageJson = readJson(repositoryRoot, path.posix.join(project === '.' ? '' : project, 'package.json'));
    } catch (error) {
      errors.push(`${project}/package.json: ${error.message}`);
      continue;
    }

    const tuples = lockfileLifecycleTuples(lockfile);
    for (const tuple of tuples) {
      if (typeof tuple.version !== 'string' || tuple.version === '') {
        errors.push(`${lockfilePath}:${tuple.packagePath}: hasInstallScript entry is missing an exact version`);
      }
    }
    const expectedTupleKeys = new Set(tuples.map((tuple) => tuple.key));
    const packageLifecycles = projectPolicy.packageLifecycles ?? {};

    if (!projectPolicy.packageLifecycles || typeof projectPolicy.packageLifecycles !== 'object' || Array.isArray(projectPolicy.packageLifecycles)) {
      errors.push(`${lockfilePath}: packageLifecycles must be an object`);
    }
    if (!projectPolicy.projectLifecycles || typeof projectPolicy.projectLifecycles !== 'object' || Array.isArray(projectPolicy.projectLifecycles)) {
      errors.push(`${project}/package.json: projectLifecycles must be an object`);
    }

    for (const tuple of tuples) {
      const decision = packageLifecycles[tuple.key];
      if (!decision) {
        errors.push(`${lockfilePath}: unreviewed lifecycle tuple ${tuple.key}`);
        continue;
      }
      validateDecision(decision, `${lockfilePath}:${tuple.key}`, errors);
    }
    for (const [key, decision] of Object.entries(packageLifecycles)) {
      validateDecision(decision, `${lockfilePath}:${key}`, errors);
      if (!expectedTupleKeys.has(key)) {
        errors.push(`${lockfilePath}: stale or mismatched lifecycle policy entry ${key}`);
      }
    }

    const actualProjectLifecycles = Object.fromEntries(
      INSTALL_LIFECYCLE_NAMES
        .filter((name) => typeof packageJson.scripts?.[name] === 'string')
        .map((name) => [name, packageJson.scripts[name]]),
    );
    const projectLifecycles = projectPolicy.projectLifecycles ?? {};

    for (const [name, command] of Object.entries(actualProjectLifecycles)) {
      const decision = projectLifecycles[name];
      if (!decision) {
        errors.push(`${project}/package.json: unreviewed first-party lifecycle ${name}`);
        continue;
      }
      validateDecision(decision, `${project}/package.json:${name}`, errors);
      if (decision.command !== command) {
        errors.push(`${project}/package.json:${name}: policy command ${JSON.stringify(decision.command)} does not match ${JSON.stringify(command)}`);
      }
    }
    for (const [name, decision] of Object.entries(projectLifecycles)) {
      validateDecision(decision, `${project}/package.json:${name}`, errors);
      if (!(name in actualProjectLifecycles)) {
        errors.push(`${project}/package.json: stale first-party lifecycle policy entry ${name}`);
      }
    }
  }

  return errors;
}

export function assertLifecyclePolicy(options) {
  const errors = validateLifecyclePolicy(options);
  if (errors.length > 0) {
    throw new Error(`npm lifecycle policy validation failed:\n- ${errors.join('\n- ')}`);
  }
}
