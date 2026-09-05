import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  REQUIRED_RELEASE_NOTE_HEADINGS,
  classifyReleaseTag,
  isStrictSemVer,
  previewRelease,
  validateReleasePolicy,
} from '../release-policy.mjs';

function writeJson(root, relativePath, value) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
}

function fixtureRepository(t, { version = '1.2.3' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resonate-release-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeJson(root, '.release-please-manifest.json', { '.': version });
  writeJson(root, 'release-please-config.json', {
    'release-type': 'node',
    'include-component-in-tag': false,
    'skip-github-release': true,
    packages: { '.': { component: 'resonate' } },
  });
  for (const project of ['.', 'web', 'backend', 'desktop']) {
    const prefix = project === '.' ? '' : `${project}/`;
    writeJson(root, `${prefix}package.json`, { name: `fixture-${project}`, version, private: true });
    writeJson(root, `${prefix}package-lock.json`, {
      name: `fixture-${project}`,
      version,
      lockfileVersion: 3,
      packages: { '': { name: `fixture-${project}`, version } },
    });
  }
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.github/release-notes-template.md'),
    `${REQUIRED_RELEASE_NOTE_HEADINGS.map((heading) => `## ${heading}\n\nNone\n`).join('\n')}`,
  );
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n');
  return root;
}

function git(root, ...arguments_) {
  const result = spawnSync('git', ['-C', root, ...arguments_], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commit(root, message, { body, filename = 'change.txt', append = true } = {}) {
  if (append) fs.appendFileSync(path.join(root, filename), `${message}\n`);
  git(root, 'add', '.');
  const arguments_ = ['commit', '-m', message];
  if (body) arguments_.push('-m', body);
  git(root, ...arguments_);
  return git(root, 'rev-parse', 'HEAD');
}

function gitFixtureRepository(t, options) {
  const root = fixtureRepository(t, options);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Release Policy Test');
  git(root, 'config', 'user.email', 'release-policy@example.test');
  fs.writeFileSync(path.join(root, 'change.txt'), 'baseline\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'chore: bootstrap repository');
  const bootstrapSha = git(root, 'rev-parse', 'HEAD');
  const configPath = path.join(root, 'release-please-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config['bootstrap-sha'] = bootstrapSha;
  writeJson(root, 'release-please-config.json', config);
  commit(root, 'chore: configure release preview', { append: false });
  return { root, bootstrapSha };
}

test('a complete repository release contract passes', (t) => {
  const repositoryRoot = fixtureRepository(t);
  assert.deepEqual(validateReleasePolicy({ repositoryRoot }), []);
  assert.deepEqual(validateReleasePolicy({ repositoryRoot, tag: 'v1.2.3' }), []);
  assert.deepEqual(validateReleasePolicy({ repositoryRoot, tag: 'milestone-11-sprint-9' }), []);
});

test('strict SemVer accepts prereleases and rejects ambiguous versions', () => {
  for (const version of ['0.1.0', '1.2.3', '2.0.0-rc.1', '3.4.5-beta-x']) {
    assert.equal(isStrictSemVer(version), true, version);
  }
  for (const version of ['v1.2.3', '01.2.3', '1.02.3', '1.2', '1.2.3-01', '1.2.3+build', '1.2.3-']) {
    assert.equal(isStrictSemVer(version), false, version);
  }
});

test('software and milestone tags are disjoint and malformed tags are rejected', () => {
  assert.equal(classifyReleaseTag('v1.2.3'), 'software');
  assert.equal(classifyReleaseTag('v1.2.3-rc.1'), 'software');
  assert.equal(classifyReleaseTag('milestone-11-sprint-9'), 'milestone');
  for (const tag of [
    '1.2.3',
    'v1.2',
    'v01.2.3',
    'v1.2.3+build',
    'desktop-v1.2.3',
    'milestone-11',
    'milestone-0-sprint',
    'milestone-11-Sprint-9',
    'milestone-v1.2.3-sprint',
  ]) {
    assert.equal(classifyReleaseTag(tag), 'invalid', tag);
  }
});

test('every package and both lockfile version fields must match the manifest', (t) => {
  const repositoryRoot = fixtureRepository(t);
  const packagePath = path.join(repositoryRoot, 'web/package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.version = '1.2.4';
  writeJson(repositoryRoot, 'web/package.json', packageJson);

  const lockPath = path.join(repositoryRoot, 'desktop/package-lock.json');
  const packageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  packageLock.version = '1.2.4';
  delete packageLock.packages[''].version;
  writeJson(repositoryRoot, 'desktop/package-lock.json', packageLock);

  const errors = validateReleasePolicy({ repositoryRoot });
  assert.ok(errors.some((error) => error.includes('web/package.json: version')));
  assert.ok(errors.some((error) => error.includes('desktop/package-lock.json: top-level version')));
  assert.ok(errors.some((error) => error.includes('desktop/package-lock.json: packages[""] version')));
});

test('Release Please must configure only the root package and plain v tags', (t) => {
  const repositoryRoot = fixtureRepository(t);
  writeJson(repositoryRoot, 'release-please-config.json', {
    'release-type': 'simple',
    'include-component-in-tag': true,
    'skip-github-release': false,
    packages: { '.': {}, desktop: {} },
  });

  const errors = validateReleasePolicy({ repositoryRoot });
  assert.ok(errors.some((error) => error.includes('exactly the root package')));
  assert.ok(errors.some((error) => error.includes('include-component-in-tag must be false')));
  assert.ok(errors.some((error) => error.includes('release-type must be node')));
  assert.ok(errors.some((error) => error.includes('skip-github-release must be true')));
});

test('release note headings must exist and contain text', (t) => {
  const repositoryRoot = fixtureRepository(t);
  const notesPath = path.join(repositoryRoot, '.github/release-notes-template.md');
  const sections = REQUIRED_RELEASE_NOTE_HEADINGS
    .filter((heading) => heading !== 'Security')
    .map((heading) => `## ${heading}\n\n${heading === 'Migrations' ? '<!-- fill this in -->' : 'Not applicable'}\n`);
  fs.writeFileSync(notesPath, sections.join('\n'));

  const errors = validateReleasePolicy({ repositoryRoot });
  assert.ok(errors.some((error) => error.includes('missing required heading "## Security"')));
  assert.ok(errors.some((error) => error.includes('section "Migrations" must not be empty')));
});

test('software tags must exactly match the canonical repository version', (t) => {
  const repositoryRoot = fixtureRepository(t, { version: '2.0.0-rc.1' });
  assert.deepEqual(validateReleasePolicy({ repositoryRoot, tag: 'v2.0.0-rc.1' }), []);
  assert.ok(
    validateReleasePolicy({ repositoryRoot, tag: 'v2.0.0' })
      .some((error) => error.includes('must equal canonical version tag v2.0.0-rc.1')),
  );
  assert.ok(
    validateReleasePolicy({ repositoryRoot, tag: 'release-2.0.0' })
      .some((error) => error.includes('must be vMAJOR.MINOR.PATCH')),
  );
});

test('check command reports success and failure through its exit status', (t) => {
  const repositoryRoot = fixtureRepository(t);
  const script = path.resolve('scripts/release-policy.mjs');
  const success = spawnSync(process.execPath, [script, 'check', '--repo', repositoryRoot, '--tag', 'v1.2.3'], {
    encoding: 'utf8',
  });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /internally consistent/);

  const failure = spawnSync(process.execPath, [script, 'check', '--repo', repositoryRoot, '--tag', 'desktop-v1.2.3'], {
    encoding: 'utf8',
  });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /must be vMAJOR\.MINOR\.PATCH/);
});

test('preview proposes feature, patch, and configured pre-major breaking bumps', async (t) => {
  await t.test('feature', (t) => {
    const { root } = gitFixtureRepository(t);
    git(root, 'tag', 'v1.2.3');
    const sourceSha = commit(root, 'feat(player): add queue controls');
    const { preview } = previewRelease({ repositoryRoot: root });
    assert.equal(preview.sourceSha, sourceSha);
    assert.equal(preview.baseRef, 'v1.2.3');
    assert.equal(preview.proposedVersion, '1.3.0');
    assert.equal(preview.tag, 'v1.3.0');
    assert.equal(preview.commits[0].reason, 'feature');
  });

  await t.test('patch', (t) => {
    const { root } = gitFixtureRepository(t);
    commit(root, 'fix(api): reject stale cursor');
    const { preview } = previewRelease({ repositoryRoot: root });
    assert.equal(preview.proposedVersion, '1.2.4');
    assert.ok(preview.commits.some((entry) => entry.reason === 'fix'));
  });

  await t.test('breaking before 1.0', (t) => {
    const { root } = gitFixtureRepository(t, { version: '0.4.0' });
    const configPath = path.join(root, 'release-please-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config['bump-minor-pre-major'] = true;
    writeJson(root, 'release-please-config.json', config);
    commit(root, 'chore: enable pre-major policy', { append: false });
    commit(root, 'feat(api)!: replace catalog response');
    const { preview } = previewRelease({ repositoryRoot: root });
    assert.equal(preview.proposedVersion, '0.5.0');
    assert.ok(preview.commits.some((entry) => entry.reason === 'breaking change'));
  });
});

test('preview returns null version and tag when no commit is release-worthy', (t) => {
  const { root } = gitFixtureRepository(t);
  commit(root, 'docs: clarify the release runbook');
  const { preview } = previewRelease({ repositoryRoot: root });
  assert.equal(preview.proposedVersion, null);
  assert.equal(preview.tag, null);
  assert.ok(preview.commits.every((entry) => entry.level === null));
});

test('preview honors an explicit reachable source and rejects an unreachable source', (t) => {
  const { root, bootstrapSha } = gitFixtureRepository(t);
  const patchSha = commit(root, 'fix: first candidate');
  commit(root, 'feat: later candidate');
  assert.equal(previewRelease({ repositoryRoot: root, source: patchSha }).preview.proposedVersion, '1.2.4');

  git(root, 'checkout', '-b', 'side', bootstrapSha);
  const unreachableSha = commit(root, 'fix: side branch only', { filename: 'side.txt' });
  git(root, 'checkout', 'main');
  assert.throws(
    () => previewRelease({ repositoryRoot: root, source: unreachableSha }),
    /not reachable from local main or origin\/main/,
  );
});

test('preview output is deterministic and leaves git status unchanged', (t) => {
  const { root } = gitFixtureRepository(t);
  commit(root, 'perf(web): avoid redundant render');
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resonate-release-preview-'));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const firstPath = path.join(outputRoot, 'first.json');
  const secondPath = path.join(outputRoot, 'second.json');
  const cliPath = path.join(outputRoot, 'cli.json');
  const before = git(root, 'status', '--porcelain=v1');

  previewRelease({ repositoryRoot: root, outputPath: firstPath });
  previewRelease({ repositoryRoot: root, outputPath: secondPath });
  const command = spawnSync(process.execPath, [
    path.resolve('scripts/release-policy.mjs'),
    'preview',
    '--repo', root,
    '--output', cliPath,
  ], { encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);

  assert.equal(fs.readFileSync(firstPath, 'utf8'), fs.readFileSync(secondPath, 'utf8'));
  assert.equal(fs.readFileSync(firstPath, 'utf8'), fs.readFileSync(cliPath, 'utf8'));
  assert.equal(git(root, 'status', '--porcelain=v1'), before);
  const document = JSON.parse(fs.readFileSync(firstPath, 'utf8'));
  assert.equal(document.dryRun, true);
  assert.equal(document.proposedVersion, '1.2.4');
});
