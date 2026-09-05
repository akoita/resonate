---
title: "Selective CI Validation"
status: implemented
owner: "@akoita"
---

# Selective CI validation

## Status and audience

Implemented for maintainers and developers. Ordinary pull requests validate the
packages affected by their changes; unknown paths and queue/release candidates
retain conservative coverage. This is vision-neutral infrastructure/quality
work, with no user-facing behavior or new application environment variables.

## How selection works

[CI](../../.github/workflows/ci.yml) checks out the candidate, runs the classifier
regression tests, and calls
[classify-ci-changes.sh](../../.github/scripts/classify-ci-changes.sh).
The Detect Changes summary shows the resulting package and backend-domain flags.

| Change or invocation | Validation |
| --- | --- |
| Documentation, scoped agent instructions, known client metadata such as `.claude/settings.json` | Lightweight Detect Changes and Lint receipt; application suites skip. The separate security workflow still reviews the PR. |
| Backend code/tests/configuration | Matching backend domain suites, or full backend suites for shared backend changes |
| Web code/assets, including help content/screenshots | Web lint, build, and E2E tests |
| Contract, desktop, or worker implementation | Corresponding package jobs |
| Mixed documentation and code | All selected code jobs; never treated as documentation-only |
| Unknown paths, shared tooling, CI workflow | Conservative shared validation |
| Missing base, failed diff, or empty change list | Full validation fallback |
| GitHub merge group or Mergify queue PR | Full validation |
| Explicit release validation | Full validation, including when the caller originated from a main push |
| Ordinary main push | Existing lightweight post-merge receipt; release validation remains separate |

The documentation exceptions are deliberately narrow. Markdown consumed inside
runtime directories still selects that package, and executable scripts inside
skills retain the shared fallback. Renaming code into a documentation directory
still validates its former package because both deletion and addition are
classified. NUL-delimited Git output preserves filenames with whitespace.

## Job dependencies

Lint, backend unit/integration tests, web build, and desktop package smoke jobs
can start after Detect Changes. Lint remains a required check; removing its
scheduling dependency does not remove its merge gate. Failed lint may therefore
consume more runner time before the other jobs finish or are cancelled.

E2E waits for the web build artifact. Backend Tests aggregates both backend
suites and fails when either does not succeed. The deployable frontend artifact
still waits for successful lint. Check names, token permissions, action pins,
installation hardening, and release/deployment boundaries are unchanged.

In the [PR #1728 baseline run](https://github.com/akoita/resonate/actions/runs/33940895060),
Lint took 2m10s before independent tests/builds could start. Removing that edge
eliminates that scheduling delay when runner capacity is available. The same
agent-configuration change set now classifies as documentation-only in the
regression test. Actual wall-clock savings depend on runner queues and other
required workflows; the baseline is evidence, not a timing guarantee.

## Use and verification

Open a PR and inspect **Detect Changes → Change detection**. If a package is
unexpectedly absent, fix the classifier and add a regression case before merging.
Use workflow dispatch for full validation when coverage is uncertain. Keep
required check names stable; skipped jobs are handled at job level rather than
filtering out the whole workflow and leaving required checks pending.

Local checks:

```bash
python3 -m unittest discover -s .github/scripts/tests -p 'test_ci_*.py'
bash -n .github/scripts/classify-ci-changes.sh
python3 .github/scripts/workflow_trigger_policy.py validate
actionlint .github/workflows/ci.yml
```

The tests use temporary Git repositories for metadata-only changes, package
selection, mixed changes, renames, unusual filenames, invalid bases, unrelated
histories, and queue/release/main modes. Workflow graph tests protect required
check names and artifact dependencies. No database or npm installation is needed.

Dependabot's monthly multi-ecosystem group owns its `open-pull-requests-limit`;
individual updates in that group must not repeat it. See
[dependabot.yml](../../.github/dependabot.yml). This corrects the configuration
error that prevented Mergify's zero-failed-check queue condition from matching.

## Related guidance

- [Release process](release_process.md): exact-source validation and publication.
- [Deployment architecture](../architecture/deployment_architecture.md).
- [Agent and security skills](../engineering/agent-skills.md).
- [GitHub job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions).
- [Dependabot multi-ecosystem configuration](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configuring-multi-ecosystem-updates).
