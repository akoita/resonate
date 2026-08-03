#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { assertNpmLockSources } from './check-npm-lock-sources.mjs';
import {
  FIRST_PARTY_PROJECTS,
  REPOSITORY_ROOT,
  assertLifecyclePolicy,
  lifecycleTupleKey,
  loadLifecyclePolicy,
  lockfileLifecycleTuples,
  readJson,
} from './npm-lifecycle-policy.mjs';

function normalizeProject(project) {
  const normalized = project === '' ? '.' : project.replaceAll('\\', '/').replace(/\/$/, '');
  if (!FIRST_PARTY_PROJECTS.some((entry) => entry.project === normalized)) {
    throw new Error(`Unknown first-party npm project ${JSON.stringify(project)}`);
  }
  return normalized;
}

function validateCiArgs(ciArgs) {
  for (const argument of ciArgs) {
    if (/^--?(?:ignore-scripts|foreground-scripts|script-shell)(?:=|$)/.test(argument)) {
      throw new Error(`Hardened npm install does not allow lifecycle-related npm ci argument ${JSON.stringify(argument)}`);
    }
  }
}

export function createInstallPlan({
  repositoryRoot = REPOSITORY_ROOT,
  project = '.',
  ciArgs = [],
  requestedProjectLifecycles = [],
  policy = loadLifecyclePolicy(repositoryRoot),
} = {}) {
  assertLifecyclePolicy({ repositoryRoot, policy });
  validateCiArgs(ciArgs);

  const normalizedProject = normalizeProject(project);
  const projectPolicy = policy.projects[normalizedProject];
  const projectRoot = path.join(repositoryRoot, normalizedProject);
  const lockfile = readJson(repositoryRoot, projectPolicy.lockfile);
  const tuples = lockfileLifecycleTuples(lockfile);
  const tupleByKey = new Map(tuples.map((tuple) => [tuple.key, tuple]));

  const rebuilds = Object.entries(projectPolicy.packageLifecycles)
    .filter(([, decision]) => decision.disposition === 'execute')
    .map(([key, decision]) => {
      const tuple = tupleByKey.get(key);
      if (!tuple) {
        throw new Error(`${projectPolicy.lockfile}: lifecycle policy entry disappeared while planning: ${key}`);
      }
      return {
        ...tuple,
        executionOrder: decision.executionOrder ?? 1000,
        cwd: projectRoot,
        command: 'npm',
        args: [
          'rebuild',
          '--offline',
          '--ignore-scripts=false',
          '--foreground-scripts',
          '--',
          `file:./${tuple.packagePath}`,
        ],
      };
    })
    .sort((left, right) => left.executionOrder - right.executionOrder || left.key.localeCompare(right.key));

  const projectLifecycles = requestedProjectLifecycles.map((name) => {
    const decision = projectPolicy.projectLifecycles[name];
    if (!decision || decision.disposition !== 'execute') {
      throw new Error(`${normalizedProject}: project lifecycle ${JSON.stringify(name)} is not approved for execution`);
    }
    return {
      name,
      commandText: decision.command,
      cwd: projectRoot,
      command: 'npm',
      // npm runs the named script with ignore-scripts enabled, but suppresses
      // any unreviewed pre<name>/post<name> hooks around it.
      args: ['run', '--ignore-scripts=true', '--', name],
    };
  });

  return {
    project: normalizedProject,
    projectRoot,
    ci: {
      cwd: projectRoot,
      command: 'npm',
      args: ['ci', ...ciArgs, '--ignore-scripts'],
    },
    rebuilds,
    projectLifecycles,
  };
}

export function resolveInvocation(step, {
  platform = process.platform,
  nodeExecutable = process.execPath,
  pathEnvironment = process.env.PATH ?? '',
  fileExists = fs.existsSync,
} = {}) {
  if (platform === 'win32' && step.command === 'npm') {
    const directories = pathEnvironment
      .split(';')
      .map((entry) => entry.replace(/^"|"$/g, ''))
      .filter(Boolean);
    for (const directory of directories) {
      const npmShim = path.join(directory, 'npm.cmd');
      const npmCli = path.join(directory, 'node_modules/npm/bin/npm-cli.js');
      if (fileExists(npmShim) && fileExists(npmCli)) {
        return { command: nodeExecutable, args: [npmCli, ...step.args] };
      }
    }
    throw new Error('Unable to locate npm.cmd and its npm CLI on PATH');
  }
  return { command: step.command, args: step.args };
}

function runCommand(step, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const invocation = resolveInvocation(step);
    const child = spawn(invocation.command, invocation.args, {
      cwd: step.cwd,
      env: { ...process.env, ...extraEnvironment },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${step.command} ${step.args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
      }
    });
  });
}

function npmOmitSet(ciArgs) {
  const omitted = new Set(
    String(process.env.npm_config_omit ?? '')
      .split(/[\s,]+/)
      .filter(Boolean),
  );
  for (let index = 0; index < ciArgs.length; index += 1) {
    const argument = ciArgs[index];
    const match = argument.match(/^--omit=(.+)$/);
    if (match) {
      for (const value of match[1].split(',')) omitted.add(value);
    } else if (argument === '--omit' && ciArgs[index + 1]) {
      for (const value of ciArgs[++index].split(',')) omitted.add(value);
    }
  }
  if (process.env.NODE_ENV === 'production') omitted.add('dev');
  return omitted;
}

function assertInstalledTuple(step, omitted) {
  const packageDirectory = path.resolve(step.cwd, step.packagePath);
  const nodeModulesRoot = path.resolve(step.cwd, 'node_modules');
  if (packageDirectory !== nodeModulesRoot && !packageDirectory.startsWith(`${nodeModulesRoot}${path.sep}`)) {
    throw new Error(`Refusing lifecycle path outside node_modules: ${step.packagePath}`);
  }

  const packageJsonPath = path.join(packageDirectory, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    if (step.optional || (step.dev && omitted.has('dev')) || omitted.has('optional')) {
      return false;
    }
    throw new Error(`Approved lifecycle package is not installed: ${step.packagePath}`);
  }

  const installed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (installed.version !== step.version) {
    throw new Error(
      `Installed lifecycle package mismatch at ${step.packagePath}: expected ${step.version}, found ${installed.version ?? '<missing>'}`,
    );
  }

  const realPackageDirectory = fs.realpathSync(packageDirectory);
  const realNodeModulesRoot = fs.realpathSync(nodeModulesRoot);
  if (!realPackageDirectory.startsWith(`${realNodeModulesRoot}${path.sep}`)) {
    throw new Error(`Refusing symlinked lifecycle package outside node_modules: ${step.packagePath}`);
  }
  return true;
}

export async function runHardenedInstall(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  assertNpmLockSources(repositoryRoot);
  const plan = createInstallPlan({ ...options, repositoryRoot });
  await runCommand(plan.ci, { npm_config_ignore_scripts: 'true' });

  // Re-read the checked-in inventory after npm has materialized node_modules,
  // before granting any lifecycle execution.
  assertNpmLockSources(repositoryRoot);
  assertLifecyclePolicy({
    repositoryRoot,
    policy: options.policy ?? loadLifecyclePolicy(repositoryRoot),
  });

  const omitted = npmOmitSet(options.ciArgs ?? []);
  for (const rebuild of plan.rebuilds) {
    if (!assertInstalledTuple(rebuild, omitted)) {
      console.log(`Skipping absent optional/omitted lifecycle package ${lifecycleTupleKey(rebuild.packagePath, rebuild.version)}`);
      continue;
    }
    console.log(`Rebuilding approved lifecycle package ${lifecycleTupleKey(rebuild.packagePath, rebuild.version)}`);
    await runCommand(rebuild, {
      npm_config_offline: 'true',
      npm_config_ignore_scripts: 'false',
    });
  }

  for (const lifecycle of plan.projectLifecycles) {
    console.log(`Running approved first-party lifecycle ${lifecycle.name}: ${lifecycle.commandText}`);
    await runCommand(lifecycle, { npm_config_ignore_scripts: 'true' });
  }
}

function parseArguments(argv) {
  let project = '.';
  const requestedProjectLifecycles = [];
  const ciArgs = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (passthrough) {
      ciArgs.push(argument);
    } else if (argument === '--') {
      passthrough = true;
    } else if (argument === '--project') {
      project = argv[++index];
      if (!project) throw new Error('--project requires a value');
    } else if (argument.startsWith('--project=')) {
      project = argument.slice('--project='.length);
    } else if (argument === '--run-project-lifecycle') {
      const name = argv[++index];
      if (!name) throw new Error('--run-project-lifecycle requires a value');
      requestedProjectLifecycles.push(name);
    } else if (argument.startsWith('--run-project-lifecycle=')) {
      requestedProjectLifecycles.push(argument.slice('--run-project-lifecycle='.length));
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(argument)}; pass npm ci arguments after --`);
    }
  }

  return { project, ciArgs, requestedProjectLifecycles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHardenedInstall(parseArguments(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
