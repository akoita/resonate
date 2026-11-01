import assert from 'node:assert/strict';
import test from 'node:test';

import { blockingFindings, evaluate, validateExceptions } from '../check-release-advisories.mjs';

const report = {
  vulnerabilities: {
    zod: {
      via: [
        { severity: 'high', url: 'https://github.com/advisories/GHSA-aaaa', title: 'zod issue' },
        { severity: 'moderate', url: 'https://github.com/advisories/GHSA-bbbb', title: 'minor' },
      ],
    },
    '@x402/core': { via: ['zod'] },
  },
};

const exception = {
  ghsa: 'GHSA-aaaa',
  package: 'zod',
  projects: ['web'],
  expires: '2026-11-30',
  reason: 'no fix yet',
  tracking: 'upgrade',
};

test('only direct high and critical advisories are findings', () => {
  assert.deepEqual(blockingFindings('web', report), [
    { project: 'web', package: 'zod', ghsa: 'GHSA-aaaa', severity: 'high', title: 'zod issue' },
  ]);
});

test('a finding without an exception fails', () => {
  const { failures } = evaluate(blockingFindings('web', report), [], '2026-11-01');
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no exception/);
});

test('an unexpired exception for the same project passes', () => {
  const { failures, stale } = evaluate(blockingFindings('web', report), [exception], '2026-11-01');
  assert.deepEqual(failures, []);
  assert.deepEqual(stale, []);
});

test('the exception still applies on its expiry date and fails after it', () => {
  assert.deepEqual(evaluate(blockingFindings('web', report), [exception], '2026-11-30').failures, []);
  assert.match(evaluate(blockingFindings('web', report), [exception], '2026-12-01').failures[0], /expired/);
});

test('an exception for another project does not apply', () => {
  const { failures, stale } = evaluate(blockingFindings('backend', report), [exception], '2026-11-01');
  assert.equal(failures.length, 1);
  assert.equal(stale.length, 1);
});

test('exceptions must carry a reason, tracking, projects and a date', () => {
  assert.deepEqual(validateExceptions([exception]), []);
  const problems = validateExceptions([{ ghsa: 'GHSA-aaaa', package: 'zod', expires: 'soon' }]);
  assert.ok(problems.some((problem) => problem.includes('reason')));
  assert.ok(problems.some((problem) => problem.includes('projects')));
  assert.ok(problems.some((problem) => problem.includes('YYYY-MM-DD')));
});
