#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VERSIONED_PROJECTS = Object.freeze([
  '.',
  'web',
  'backend',
  'desktop',
]);

export const REQUIRED_RELEASE_NOTE_HEADINGS = Object.freeze([
  'User-visible changes',
  'API and contract changes',
  'Operations and deployments',
  'Security',
  'Migrations',
  'Known limitations and deferred work',
  'Release evidence',
]);

const SEMVER_IDENTIFIER = '(?:0|[1-9]\\d*)';
const PRERELEASE_IDENTIFIER = '(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const STRICT_SEMVER = new RegExp(
  `^${SEMVER_IDENTIFIER}\\.${SEMVER_IDENTIFIER}\\.${SEMVER_IDENTIFIER}`
    + `(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?$`,
);
const SOFTWARE_TAG = new RegExp(`^v(${STRICT_SEMVER.source.slice(1, -1)})$`);
const MILESTONE_TAG = /^milestone-([1-9]\d*)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function isStrictSemVer(value) {
  return typeof value === 'string' && STRICT_SEMVER.test(value);
}

export function classifyReleaseTag(tag) {
  if (typeof tag !== 'string' || tag.length === 0) return 'invalid';
  if (SOFTWARE_TAG.test(tag)) return 'software';
  if (MILESTONE_TAG.test(tag)) return 'milestone';
  return 'invalid';
}

function readJson(repositoryRoot, relativePath, errors) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  let source;
  try {
    source = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    errors.push(`${relativePath}: unable to read file (${error.message})`);
    return null;
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function readText(repositoryRoot, relativePath, errors) {
  try {
    return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    errors.push(`${relativePath}: unable to read file (${error.message})`);
    return null;
  }
}

function projectPath(project, filename) {
  return project === '.' ? filename : path.posix.join(project, filename);
}

function validateProjectVersions(repositoryRoot, canonicalVersion, errors) {
  for (const project of VERSIONED_PROJECTS) {
    const packagePath = projectPath(project, 'package.json');
    const lockPath = projectPath(project, 'package-lock.json');
    const packageJson = readJson(repositoryRoot, packagePath, errors);
    const packageLock = readJson(repositoryRoot, lockPath, errors);

    if (packageJson && packageJson.version !== canonicalVersion) {
      errors.push(`${packagePath}: version must equal canonical version ${canonicalVersion}`);
    }
    if (!packageLock) continue;
    if (packageLock.version !== canonicalVersion) {
      errors.push(`${lockPath}: top-level version must equal canonical version ${canonicalVersion}`);
    }
    if (packageLock.packages?.['']?.version !== canonicalVersion) {
      errors.push(`${lockPath}: packages[""] version must equal canonical version ${canonicalVersion}`);
    }
  }
}

function validateReleasePleaseConfig(config, errors) {
  if (!config) return;
  const packageKeys = config.packages && typeof config.packages === 'object'
    && !Array.isArray(config.packages)
    ? Object.keys(config.packages)
    : [];
  if (packageKeys.length !== 1 || packageKeys[0] !== '.') {
    errors.push('release-please-config.json: packages must contain exactly the root package "."');
  }
  if (config['include-component-in-tag'] !== false) {
    errors.push('release-please-config.json: include-component-in-tag must be false for plain v tags');
  }
  if (config['include-v-in-tag'] === false) {
    errors.push('release-please-config.json: include-v-in-tag must not disable the v prefix');
  }
  if (config.packages?.['.']?.['include-component-in-tag'] === true) {
    errors.push('release-please-config.json: root package must not override plain v tags');
  }
  if (config['release-type'] !== 'node') {
    errors.push('release-please-config.json: release-type must be node for the canonical root version');
  }
  if (config['skip-github-release'] !== true) {
    errors.push('release-please-config.json: skip-github-release must be true so evidence validation owns publication');
  }
}

function releaseNoteSections(source) {
  const sections = new Map();
  const headingPattern = /^##\s+(.+?)\s*#*\s*$/gm;
  const matches = [...source.matchAll(headingPattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const heading = matches[index][1].trim();
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    sections.set(heading, source.slice(start, end));
  }
  return sections;
}

function hasMeaningfulSectionContent(value) {
  const withoutComments = value.replace(/<!--[\s\S]*?-->/g, '');
  return /[0-9A-Za-z]/.test(withoutComments);
}

function validateReleaseNotes(source, errors) {
  if (source === null) return;
  const sections = releaseNoteSections(source);
  for (const heading of REQUIRED_RELEASE_NOTE_HEADINGS) {
    if (!sections.has(heading)) {
      errors.push(`.github/release-notes-template.md: missing required heading "## ${heading}"`);
    } else if (!hasMeaningfulSectionContent(sections.get(heading))) {
      errors.push(`.github/release-notes-template.md: section "${heading}" must not be empty`);
    }
  }
}

export function validateReleasePolicy({ repositoryRoot = REPOSITORY_ROOT, tag } = {}) {
  const errors = [];
  const manifest = readJson(repositoryRoot, '.release-please-manifest.json', errors);
  const config = readJson(repositoryRoot, 'release-please-config.json', errors);
  const releaseNotes = readText(repositoryRoot, '.github/release-notes-template.md', errors);
  const canonicalVersion = manifest?.['.'];

  if (!isStrictSemVer(canonicalVersion)) {
    errors.push('.release-please-manifest.json: root version must be strict SemVer without build metadata');
  } else {
    validateProjectVersions(repositoryRoot, canonicalVersion, errors);
  }
  validateReleasePleaseConfig(config, errors);
  validateReleaseNotes(releaseNotes, errors);

  if (tag !== undefined) {
    const tagType = classifyReleaseTag(tag);
    if (tagType === 'invalid') {
      errors.push(`release tag "${tag}" must be vMAJOR.MINOR.PATCH[-prerelease] or milestone-N-slug`);
    } else if (tagType === 'software' && tag !== `v${canonicalVersion}`) {
      errors.push(`software tag "${tag}" must equal canonical version tag v${canonicalVersion}`);
    }
  }

  return errors;
}

function git(repositoryRoot, arguments_, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', repositoryRoot, ...arguments_], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', allowFailure ? 'ignore' : 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`git ${arguments_.join(' ')} failed: ${detail}`);
  }
}

function resolveSourceSha(repositoryRoot, source) {
  const revision = source || 'HEAD';
  const sourceSha = git(repositoryRoot, ['rev-parse', '--verify', `${revision}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error(`source ${revision} did not resolve to a full commit SHA`);
  }
  return sourceSha;
}

function existingMainRefs(repositoryRoot) {
  return ['refs/heads/main', 'refs/remotes/origin/main'].filter((ref) => (
    git(repositoryRoot, ['show-ref', '--verify', '--quiet', ref], { allowFailure: true }) !== null
  ));
}

function requireReachableFromMain(repositoryRoot, sourceSha) {
  const mainRefs = existingMainRefs(repositoryRoot);
  if (mainRefs.length === 0) {
    throw new Error('release preview requires a local main or origin/main ref');
  }
  const reachable = mainRefs.some((ref) => (
    git(repositoryRoot, ['merge-base', '--is-ancestor', sourceSha, ref], { allowFailure: true }) !== null
  ));
  if (!reachable) {
    throw new Error(`source ${sourceSha} is not reachable from local main or origin/main`);
  }
}

function latestReachableSoftwareTag(repositoryRoot, sourceSha) {
  const tags = git(repositoryRoot, [
    'tag',
    '--merged', sourceSha,
    '--list', 'v*',
    '--sort=-version:refname',
  ]).split('\n').filter(Boolean);
  return tags.find((tag) => classifyReleaseTag(tag) === 'software') ?? null;
}

function resolveBoundary(repositoryRoot, sourceSha, config) {
  const tag = latestReachableSoftwareTag(repositoryRoot, sourceSha);
  if (tag) return tag;

  const bootstrapSha = config?.['bootstrap-sha'];
  if (typeof bootstrapSha !== 'string' || !/^[0-9a-f]{40}$/.test(bootstrapSha)) {
    throw new Error('release preview requires a reachable strict v* tag or full release-please bootstrap-sha');
  }
  const resolvedBootstrap = resolveSourceSha(repositoryRoot, bootstrapSha);
  if (git(repositoryRoot, ['merge-base', '--is-ancestor', resolvedBootstrap, sourceSha], { allowFailure: true }) === null) {
    throw new Error(`release-please bootstrap-sha ${bootstrapSha} is not an ancestor of source ${sourceSha}`);
  }
  return resolvedBootstrap;
}

function releaseConfigValue(config, name) {
  return config?.packages?.['.']?.[name] ?? config?.[name];
}

function conventionalCommitReason(subject, body) {
  const match = /^(?<type>[a-z][a-z0-9-]*)(?:\([^\r\n()]+\))?(?<breaking>!)?: (?<summary>.+)$/.exec(subject);
  if (!match) return { level: null, reason: 'not a conventional commit' };
  const hasBreakingFooter = /^BREAKING(?: CHANGE|-CHANGE):\s+\S/im.test(body);
  if (match.groups.breaking || hasBreakingFooter) return { level: 'major', reason: 'breaking change' };
  if (match.groups.type === 'feat') return { level: 'minor', reason: 'feature' };
  if (['fix', 'perf', 'revert'].includes(match.groups.type)) {
    return { level: 'patch', reason: match.groups.type };
  }
  return { level: null, reason: `conventional type ${match.groups.type} does not trigger a release` };
}

function commitsSince(repositoryRoot, boundary, sourceSha) {
  const recordSeparator = '\x1e';
  const fieldSeparator = '\x1f';
  const output = git(repositoryRoot, [
    'log',
    '--reverse',
    `--format=%H%x1f%s%x1f%b%x1e`,
    `${boundary}..${sourceSha}`,
  ]);
  if (!output) return [];
  return output.split(recordSeparator).map((record) => record.trim()).filter(Boolean).map((record) => {
    const [sha, summary, ...bodyParts] = record.split(fieldSeparator);
    const { level, reason } = conventionalCommitReason(summary, bodyParts.join(fieldSeparator));
    return { sha, summary, level, reason };
  });
}

function nextVersion(currentVersion, commits, config) {
  const levels = new Set(commits.map((commit) => commit.level).filter(Boolean));
  if (levels.size === 0) return null;
  const [major, minor, patch] = currentVersion.split('-', 1)[0].split('.').map(Number);
  if (levels.has('major')) {
    if (major === 0 && releaseConfigValue(config, 'bump-minor-pre-major') === true) {
      return `0.${minor + 1}.0`;
    }
    return `${major + 1}.0.0`;
  }
  if (levels.has('minor')) {
    if (major === 0 && releaseConfigValue(config, 'bump-patch-for-minor-pre-major') === true) {
      return `0.${minor}.${patch + 1}`;
    }
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export function previewRelease({
  repositoryRoot = REPOSITORY_ROOT,
  source,
  outputPath,
} = {}) {
  const errors = validateReleasePolicy({ repositoryRoot });
  if (errors.length > 0) throw new Error(`release policy validation failed:\n${errors.join('\n')}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, '.release-please-manifest.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'release-please-config.json'), 'utf8'));
  const currentVersion = manifest['.'];
  const sourceSha = resolveSourceSha(repositoryRoot, source);
  requireReachableFromMain(repositoryRoot, sourceSha);
  const baseRef = resolveBoundary(repositoryRoot, sourceSha, config);
  const commits = commitsSince(repositoryRoot, baseRef, sourceSha);
  const proposedVersion = nextVersion(currentVersion, commits, config);
  const preview = {
    dryRun: true,
    sourceSha,
    baseRef,
    currentVersion,
    proposedVersion,
    tag: proposedVersion ? `v${proposedVersion}` : null,
    commits,
  };
  const serialized = `${JSON.stringify(preview, null, 2)}\n`;
  if (outputPath) {
    const absoluteOutput = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
    fs.writeFileSync(absoluteOutput, serialized);
  }
  return { preview, serialized };
}

function parseCheckArguments(arguments_) {
  let repositoryRoot = REPOSITORY_ROOT;
  let tag;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--repo') {
      if (!arguments_[index + 1]) throw new Error('--repo requires a path');
      repositoryRoot = path.resolve(arguments_[index + 1]);
      index += 1;
    } else if (argument === '--tag') {
      if (!arguments_[index + 1]) throw new Error('--tag requires a tag');
      tag = arguments_[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown check argument: ${argument}`);
    }
  }
  return { repositoryRoot, tag };
}

function parsePreviewArguments(arguments_) {
  let repositoryRoot = REPOSITORY_ROOT;
  let source;
  let outputPath;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === '--repo' || argument === '--source' || argument === '--output') {
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === '--repo') repositoryRoot = path.resolve(value);
      if (argument === '--source') source = value;
      if (argument === '--output') outputPath = value;
      index += 1;
    } else {
      throw new Error(`unknown preview argument: ${argument}`);
    }
  }
  return { repositoryRoot, source, outputPath };
}

export function main(arguments_ = process.argv.slice(2)) {
  const [command, ...commandArguments] = arguments_;
  if (!['check', 'preview'].includes(command)) {
    console.error('Usage: node scripts/release-policy.mjs check [--repo PATH] [--tag TAG]');
    console.error('       node scripts/release-policy.mjs preview [--repo PATH] [--source SHA] [--output PATH]');
    return 2;
  }

  try {
    if (command === 'preview') {
      const { serialized } = previewRelease(parsePreviewArguments(commandArguments));
      if (!commandArguments.includes('--output')) process.stdout.write(serialized);
      return 0;
    }
    const errors = validateReleasePolicy(parseCheckArguments(commandArguments));
    if (errors.length > 0) {
      for (const error of errors) console.error(`release policy: ${error}`);
      return 1;
    }
    console.log('Release policy is internally consistent.');
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
