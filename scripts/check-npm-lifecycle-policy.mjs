#!/usr/bin/env node
import { assertLifecyclePolicy } from './npm-lifecycle-policy.mjs';

try {
  assertLifecyclePolicy();
  console.log('npm lifecycle policy exactly matches all first-party lockfiles and project-owned install lifecycles.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
