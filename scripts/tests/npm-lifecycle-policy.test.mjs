import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateNpmLockSources } from '../check-npm-lock-sources.mjs';
import { createInstallPlan, resolveInvocation } from '../hardened-npm-install.mjs';
import {
  FIRST_PARTY_PROJECTS,
  POLICY_PATH,
  REPOSITORY_ROOT,
  loadLifecyclePolicy,
  validateLifecyclePolicy,
} from '../npm-lifecycle-policy.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureRepository(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resonate-npm-policy-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  for (const { project, lockfile } of FIRST_PARTY_PROJECTS) {
    const packageJson = path.posix.join(project === '.' ? '' : project, 'package.json');
    for (const relativePath of [packageJson, lockfile]) {
      const destination = path.join(fixtureRoot, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(REPOSITORY_ROOT, relativePath), destination);
    }
  }
  const policyDestination = path.join(fixtureRoot, POLICY_PATH);
  fs.mkdirSync(path.dirname(policyDestination), { recursive: true });
  fs.copyFileSync(path.join(REPOSITORY_ROOT, POLICY_PATH), policyDestination);
  return fixtureRoot;
}

test('checked-in policy exactly matches the first-party lifecycle inventory', () => {
  assert.deepEqual(validateLifecyclePolicy(), []);
});

test('npm command resolution launches the Windows CLI through Node', () => {
  assert.deepEqual(resolveInvocation({ command: 'npm', args: ['ci'] }, 'win32', '/node/node.exe'), {
    command: '/node/node.exe',
    args: ['/node/node_modules/npm/bin/npm-cli.js', 'ci'],
  });
  assert.deepEqual(resolveInvocation({ command: 'npm', args: ['ci'] }, 'linux', '/usr/bin/node'), {
    command: 'npm',
    args: ['ci'],
  });
});

test('an unreviewed lockfile lifecycle tuple fails closed', (t) => {
  const repositoryRoot = fixtureRepository(t);
  const lockfilePath = path.join(repositoryRoot, 'backend/package-lock.json');
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  lockfile.packages['node_modules/new-native-addon'] = {
    version: '1.2.3',
    hasInstallScript: true,
  };
  fs.writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);

  const errors = validateLifecyclePolicy({ repositoryRoot });
  assert.ok(errors.some((error) => error.includes('unreviewed lifecycle tuple node_modules/new-native-addon@1.2.3')));
});

test('a stale policy tuple fails closed', () => {
  const policy = clone(loadLifecyclePolicy());
  policy.projects.web.packageLifecycles['node_modules/removed-addon@9.9.9'] = {
    disposition: 'deny',
    rationale: 'Fixture entry that no longer exists.',
  };

  const errors = validateLifecyclePolicy({ policy });
  assert.ok(errors.some((error) => error.includes('stale or mismatched lifecycle policy entry node_modules/removed-addon@9.9.9')));
});

test('a lockfile version mismatch fails closed', (t) => {
  const repositoryRoot = fixtureRepository(t);
  const lockfilePath = path.join(repositoryRoot, 'web/package-lock.json');
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  lockfile.packages['node_modules/esbuild'].version = '0.27.4';
  fs.writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);

  const errors = validateLifecyclePolicy({ repositoryRoot });
  assert.ok(errors.some((error) => error.includes('unreviewed lifecycle tuple node_modules/esbuild@0.27.4')));
  assert.ok(errors.some((error) => error.includes('stale or mismatched lifecycle policy entry node_modules/esbuild@0.27.3')));
});

test('the lock source checker covers the MCP example lockfile', (t) => {
  const repositoryRoot = fixtureRepository(t);
  const lockfilePath = path.join(repositoryRoot, 'examples/mcp-client/package-lock.json');
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  lockfile.packages['node_modules/esbuild'].resolved = 'https://example.invalid/esbuild.tgz';
  fs.writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);

  assert.ok(
    validateNpmLockSources(repositoryRoot)
      .some((error) => error.includes('examples/mcp-client/package-lock.json:node_modules/esbuild')),
  );
});

test('command planning rebuilds only execute decisions through offline local folder specs', () => {
  const plan = createInstallPlan({ project: 'backend', ciArgs: ['--omit=dev'] });
  const rebuiltKeys = plan.rebuilds.map((step) => step.key);

  assert.ok(rebuiltKeys.includes('node_modules/@prisma/client@5.22.0'));
  assert.ok(!rebuiltKeys.includes('node_modules/@nestjs/core@10.4.22'));
  assert.ok(!rebuiltKeys.includes('node_modules/protobufjs@6.11.4'));
  assert.ok(rebuiltKeys.indexOf('node_modules/@prisma/engines@5.22.0') < rebuiltKeys.indexOf('node_modules/prisma@5.22.0'));
  assert.ok(rebuiltKeys.indexOf('node_modules/prisma@5.22.0') < rebuiltKeys.indexOf('node_modules/@prisma/client@5.22.0'));
  assert.deepEqual(plan.ci.args, ['ci', '--omit=dev', '--ignore-scripts']);
  for (const rebuild of plan.rebuilds) {
    assert.equal(rebuild.command, 'npm');
    assert.ok(rebuild.args.includes('--offline'));
    assert.ok(rebuild.args.includes('--ignore-scripts=false'));
    assert.match(rebuild.args.at(-1), /^file:\.\/node_modules\//);
    assert.ok(!rebuild.args.some((argument) => argument.startsWith('https:')));
  }
});

test('root Husky prepare is explicit and suppresses unreviewed adjacent hooks', () => {
  const plan = createInstallPlan({ project: '.', requestedProjectLifecycles: ['prepare'] });
  assert.deepEqual(plan.projectLifecycles, [{
    name: 'prepare',
    commandText: 'husky',
    cwd: REPOSITORY_ROOT,
    command: 'npm',
    args: ['run', '--ignore-scripts=true', '--', 'prepare'],
  }]);
});

test('command planning rejects lifecycle overrides and unapproved project hooks', () => {
  assert.throws(
    () => createInstallPlan({ ciArgs: ['--ignore-scripts=false'] }),
    /does not allow lifecycle-related npm ci argument/,
  );
  assert.throws(
    () => createInstallPlan({ project: 'web', requestedProjectLifecycles: ['prepare'] }),
    /is not approved for execution/,
  );
});
