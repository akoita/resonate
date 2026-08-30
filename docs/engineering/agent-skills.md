# Agent Skills

This guide explains how Resonate organizes instructions for AI coding agents,
where project-specific knowledge lives, and how shared skills from
[`agent-toolkit`](https://github.com/akoita/agent-toolkit) are used across the
development lifecycle — locally and in GitHub CI.

It is for maintainers, contributors, and agents. Read it before adding a new
skill, workflow, or security gate.

## Layout

| Path | Role | Committed |
| --- | --- | --- |
| `AGENTS.md` | Single source of truth for project coding standards. | Yes |
| `CLAUDE.md`, `GEMINI.md` | Symlinks to `AGENTS.md` so each runtime finds it under the name it expects. | Yes |
| `.agents/skills/<name>/SKILL.md` | Resonate-specific capabilities, including the `start-issue`, `finish-issue`, and security-routing procedures. | Yes |
| `.claude/skills` | Symlink to `.agents/skills` so Claude Code discovers them. | Yes — the symlink is tracked; `.claude/worktrees/` and `settings.local.json` stay ignored |
| `.gemini/commands/*.toml` | Command shims that point Gemini CLI at the canonical files above. | Yes |
| `.codex/`, `.codex-tmp/` | Per-developer Codex state. Nothing project-shared lives here. | No — gitignored |

`.agents/` is not a Claude convention we bolted a shim onto; it is the
**runtime-neutral root**, and specifically the one Codex already understands.
Codex resolves plugin marketplaces from `.agents/plugins/marketplace.json`, and
the [skills CLI](https://www.skills.sh/docs) installs Codex skills to
`~/.agents/skills/` globally or `.agents/skills/` per project. `.claude/` and
`.gemini/` are the shims; `.agents/` is the source.

### Conform to the spec

The [Agent Skills specification](https://agentskills.io/specification) defines a
skill as a directory containing `SKILL.md` plus optional `scripts/`,
`references/`, and `assets/`. Nothing else is standard. Two rules are easy to get
wrong and are worth checking on every new skill:

- **`name` must equal the parent directory name**, and may contain only
  `a-z`, `0-9`, and single non-leading, non-trailing hyphens. A snake_case
  directory with a kebab-case `name:` is non-conformant, even though several
  published skill collections ship exactly that.
- **`version` is not a top-level field.** The only recognized top-level keys are
  `name`, `description`, `license`, `compatibility`, `metadata`, and
  `allowed-tools`. Put a version under `metadata`.

This is why there is no `.agents/workflows/` directory: it was never part of the
spec, and it bought nothing — with no `.claude/commands/` in this repository,
`/start-issue` was never a real slash command, just prose that `AGENTS.md`
pointed at. Both procedures are now ordinary skills, so they are discoverable by
the same mechanism as every other capability. **If an agent can invoke it, it is
a skill.** Validate with
[`skills-ref`](https://github.com/agentskills/agentskills/tree/main/skills-ref):

```bash
skills-ref validate .agents/skills/finish-issue
```

### How each runtime finds a skill

| Runtime | Mechanism | Auto-discovered |
| --- | --- | --- |
| Claude Code | `.claude/skills` → `.agents/skills` symlink | Yes |
| Codex | Installed plugins provide skills; **project-local skills are not auto-discovered**. `AGENTS.md` — which Codex always reads — names the skill path explicitly. | No — via `AGENTS.md` |
| Gemini / Antigravity | `.gemini/commands/*.toml` with `@{...}` file includes | Yes, as slash commands |

This asymmetry is why `AGENTS.md` explicitly instructs agents to read
`.agents/skills/auditing-resonate-security/SKILL.md` before security work rather
than assuming the runtime surfaced it. Verified against `codex-cli 0.144.1`: the
plugin system loads skills from a plugin's `skills/` directory, and `config.toml`
exposes no project-skills path. If a future Codex release adds project-skill
discovery, the pointer becomes redundant but stays harmless.

**The rule: anything project-agnostic belongs in `agent-toolkit`, not here.**
A skill that would read the same in any TypeScript or Solidity repository is a
shared skill and should be contributed upstream, where it is versioned,
released, and maintained once. `.agents/skills/` is reserved for knowledge that
depends on Resonate's own architecture, contracts, business model, or
conventions.

`auditing-resonate-security` shows the pattern for anything with a shared
upstream equivalent: a **router plus project context**, deliberately containing
no methodology. It maps a situation to one of the seven shared skills below, then
hands that skill Resonate's stack, threat surface, house rules for findings, and
report conventions. If you find yourself writing *generic* methodology into
`.agents/skills/`, it belongs upstream instead.

Procedure is only allowed here when it is Resonate's own process and would be
meaningless in another repository — for example, `start-issue` and
`finish-issue`, which encode this project's branch, gate, and PR conventions.
Dependency-aware milestone planning is project-agnostic, so use the
`plan-milestone` skill maintained in Agent Toolkit and supply Resonate's roadmap,
Vision Sprint history, and business-model policies as repository context.

This is why the three security workflows that used to live in
`.agents/workflows/` (`smart-contract-scan`, `security-best-practices`,
`security-threat-model`) were retired: they were ports of generic Trail of Bits
prompts, they drifted from upstream, and they are now covered by maintained
shared skills. See [AI Skills Marketplace](../ai-skills-marketplace.md) for the
migration mapping.

## Install

The shared skills ship as plugins from one marketplace. Add the marketplace
once, then install by plugin name.

Claude Code:

```bash
claude plugin marketplace add akoita/agent-toolkit
claude plugin install security@agent-toolkit
claude plugin install maestro@agent-toolkit
claude plugin install utilities@agent-toolkit
```

Codex:

```bash
codex plugin marketplace add akoita/agent-toolkit
codex plugin add codex-security@agent-toolkit
codex plugin add codex-maestro@agent-toolkit
codex plugin add codex-utilities@agent-toolkit
```

Restart the tool afterwards. The skill bodies are identical on both platforms;
the Claude `security` package additionally ships two named agents
(`security-auditor`, a read-only investigator, and `security-scan-runner`, a
toolchain runner).

For a skill-only install, use
`npx skills add akoita/agent-toolkit --skill plan-milestone -g -a <agent>`
with the target supported by the skills CLI. Do not restore a project-local
copy; keeping milestone methodology upstream prevents the two versions from
drifting.

To update:

```bash
claude plugin update security@agent-toolkit
```

## The seven shared security skills

Each skill's own description states explicit anti-triggers. Respect them — the
skills are deliberately partitioned so that the wrong one is not merely slower
but produces the wrong kind of output.

| Skill | Use it for | Do **not** use it for |
| --- | --- | --- |
| `security-audit` | A deep, repository-wide or large-subsystem audit; turning scanner output into evidence-backed findings; producing a security report. Owns the shared doctrine (severity, evidence, triage, suppression, reporting) that the other skills restate. | A pull-request diff (`security-review`); running the toolchain alone (`security-scan`); dependency, CI, threat-model, smart-contract, or AI-system questions that have their own skill. |
| `security-review` | A diff, branch, pull request, or staged edits, when the question is whether the change introduces risk. Returns falsifiable, inline, **advisory** comments. | A blocking gate; a whole-repository audit (`security-audit`); running the deterministic toolchain (`security-scan`); dependency, threat-model, smart-contract, or AI-system questions. |
| `security-scan` | Choosing, installing, invoking, or wiring the free deterministic toolchain — SAST, ecosystem linters, SCA, secrets, IaC, DAST, fuzzing — and normalizing output to one digest; handling per-tool exit codes and suppression syntax; sequencing checks into pre-commit, CI, nightly, or release. | Reasoning about a diff (`security-review`); a judgment-driven repository audit (`security-audit`); supply-chain, threat-model, smart-contract, or AI-system questions. |
| `security-smart-contracts` | Solidity and EVM audit: proxy and upgradeability checks, invariant and property fuzzing design, oracle and price manipulation, ERC-4337 / EIP-7702 account abstraction, Permit2 and signature replay, L2 and cross-chain risk; running Slither, Aderyn, Echidna, Medusa, Halmos, or Foundry invariants. | Off-chain application, cloud, container, or dependency security; gas golfing; tokenomics or economic design with no security question attached. |
| `security-supply-chain` | Hardening CI/CD: auditing workflows, pinning actions to commit SHAs, package-manager and install-script risk, lockfiles and release cooldowns, SBOM emission, artifact signing and build provenance, and the repository checklists and regulatory obligations that follow (OpenSSF Scorecard, OSPS Baseline, EU CRA, NIST SSDF, OWASP ASVS and SAMM). | Application code vulnerabilities (`security-audit` for a repo audit, `security-review` for a diff); running the general scanner toolchain (`security-scan`); LLM, agent, and MCP risk (`security-ai`). |
| `security-threat-model` | Building a repository-grounded threat model: extracting the system model from code, deriving trust boundaries, assets and entry points, calibrating attacker capabilities, enumerating and ranking abuse paths, separating existing from recommended mitigations; STRIDE / LINDDUN design review; model-as-code with pytm or threagile. | Finding concrete vulnerabilities in code (`security-audit` / `security-review`); running scanners (`security-scan`); the detailed LLM, agent, and MCP control checklists (`security-ai`). |
| `security-ai` | LLM applications, AI agents, MCP servers and clients, the AI/ML supply chain, and repositories that ship agent skills or plugins: prompt and indirect injection, exfiltration paths, agent permission and sandbox hardening, MCP authorization, model/dataset/pickle provenance, AI red-teaming tool selection. | Anything where no model or agent sits in the trust path — a conventional application, infrastructure, or dependency review applies instead; legal or compliance sign-off. |

## Local lifecycle

When to reach for which skill during day-to-day development. Agents should
enter through the `auditing-resonate-security` project skill, which routes to
the shared skill and supplies the Resonate context it needs.

| Moment | Skill | Notes |
| --- | --- | --- |
| Designing a feature or a new subsystem | `security-threat-model` | Do this before the code exists, while trust boundaries are still cheap to move. Especially relevant for custody, escrow, payouts, and agent-owned keys. |
| Implementing agent, MCP, or LLM-facing code | `security-ai` | Applies to the agent commerce runtime, storefront MCP, recommendation adapters, and any skill or plugin this repo itself ships. |
| Editing `contracts/` | `security-smart-contracts` | The doctrine behind the contract test ladder in `AGENTS.md` (unit → fuzz → invariant → symbolic → mutation). |
| Pre-commit | `security-scan` (fast subset) | Secrets plus quick SAST only. Budget under five seconds — `gitleaks` on the staged diff, `detect-private-key`, `actionlint` on changed workflow files. A secret that reaches the remote is unrecoverable, which is the one thing worth blocking a commit for. Wired in `.pre-commit-config.yaml`, **opt-in** — see [Pre-commit (opt-in)](#pre-commit-opt-in). |
| Before opening a PR | `security-review` on the diff | This is what `/finish-issue` §5 now calls for `backend/` and `web/` changes (with `security-smart-contracts`, `security-ai`, and `security-supply-chain` routed by changed path). Advisory by construction: it reports, a human decides — but §5 still requires fixing High and Critical findings before proceeding. |
| Sprint boundary or release | `security-audit` + `security-supply-chain` | The unbounded pass — full-tree findings, workflow/action pinning, SBOM, provenance. Also the right cadence for reviewing accumulated baselines and suppressions. |

## GitHub CI

> [!IMPORTANT]
> **Heuristic scanners are advisory.** `.github/workflows/security.yml` and
> `.pre-commit-config.yaml` now exist (#1537 Phase 3), but nothing they report
> can fail a merge. Every heuristic scan step is `continue-on-error: true` under the
> ratchet rule, and **pre-commit is opt-in** — it is not installed for you (see
> [Pre-commit](#pre-commit-opt-in) below). Custom scanner SARIF remains
> artifact-only; CodeQL now owns native code-scanning ingestion, so uploading
> overlapping SARIF would duplicate findings and noise. No custom scanner has
> been added to the `main` ruleset.

### Native GitHub controls

The live GitHub settings audit on 2026-08-25 records the following controls:

- Private vulnerability reporting, secret scanning, push protection, Dependabot
  vulnerability alerts, and Dependabot security updates are enabled. Security
  updates are event-driven; routine version updates use
  [`.github/dependabot.yml`](../../.github/dependabot.yml) on a monthly
  04:00 Europe/Paris schedule across the declared npm, pip, Docker, Actions,
  and Foundry submodule paths.
- CodeQL default setup is enabled for `javascript-typescript`, query suite
  `default`, remote threat modeling, and the standard runner. The initial
  [run 32799678109](https://github.com/akoita/resonate/actions/runs/32799678109)
  completed successfully against the reviewed revision. The
  [initial baseline triage](../../audit/codeql-baseline-2026-08-26.md) reviewed
  all 19 leads: seven alerts map to four privately tracked findings, eleven
  were false positives, and one informational alert was accepted risk. All
  seven retained alerts were fixed on `main` by 2026-08-30. The 57.9% measured
  false-positive rate keeps CodeQL
  advisory/non-required and outside the nine required checks; any narrower
  blocking ratchet remains a separate decision after remediation.
- Partner-pattern validity checks remain disabled because GitHub documents them
  as organization-owned Team/Secret Protection functionality; GitHub-token
  validity checks remain automatic. Native secret scanning reported zero open
  or resolved alerts after enablement. Dependency-graph processing initially
  reported 270 npm advisory alerts. The
  [2026-08-30 baseline](../../audit/dependabot-baseline-2026-08-30.md) replaces
  that snapshot with four-lock reachability evidence: no local Critical, High,
  or Low npm package-level lead remains, while 32 Moderate leads have an owner,
  compensating boundary, and 2026-09-30 review date. GitHub's post-merge
  default-branch reconciliation remains tracked by
  [#1626](https://github.com/akoita/resonate/issues/1626).
- The active `main` ruleset (ID `12327414`) requires pull requests and nine
  status checks, has no bypass actors, and requires zero approving reviews.
  Zero reviews is an explicit solo-maintainer decision: raising it to one
  would deadlock pull requests. CI remains the merge gate; release controls are
  separate. The default `GITHUB_TOKEN` is read-only and cannot approve PRs.

The retained nightly scan run `32686785885` produced 19 TruffleHog
provider-verified leads that were triaged as metadata-only: 13 Lob `test_…`
function-name matches in tests and 6 upstream Forge/Infura sample IDs in a
historical vendored subtree. No Resonate-owned credential required rotation;
raw values are intentionally not documented.

| Job | Skill | Trigger | Blocking | Status |
| --- | --- | --- | --- | --- |
| `security.yml` → `Security Scan (PR, advisory)` | `security-scan` | Pull request, diff-scoped against `git merge-base origin/main HEAD` | No — advisory during the soak period | Implemented (#1537 Phase 3) |
| `security.yml` → `Nightly Security Scan (advisory)` | `security-scan` | Schedule (02:30 UTC) + `workflow_dispatch`, full tree and full history | No — digest only | Implemented (#1537 Phase 3) |
| `security.yml` → `Supply Chain Baseline` | `security-supply-chain` | Pull request, schedule, and `workflow_dispatch`; validates the T4 profile and revision-bound ABOM | Deterministic job fails on schema or mutable build inputs; separate from native CodeQL and branch ruleset requirements | Implemented (#1551) |
| `security.yml` → `Release Plane Evidence` | `security-supply-chain` | Schedule and `workflow_dispatch`; inventories privileged runs and delivery-path changes | Flags unexpected trigger classes; alert routing remains private/live evidence | Implemented (#1551) |
| ~~`code-review.yml`~~ | `security-review` | — | — | Retired (#1547). The hosted review needed its own paid `ANTHROPIC_API_KEY`; run `/code-review` locally instead. |
| `certora.yml`, `formal.yml`, `mutation.yml` | `security-smart-contracts` (doctrine) | Nightly / weekly / per-PR on `contracts/**` | `formal.yml` blocks; `certora.yml` and `mutation.yml` are scheduled-only | Implemented |

Notes on each:

- Supply-chain containment and recovery procedures are in the
  [supply-chain incident-response playbook](../operations/supply_chain_incident_response.md).

- **`Security Scan (PR, advisory)`** runs the deterministic toolchain inside a
  five-minute budget, everything diff-scoped: `gitleaks dir .` for secrets,
  `opengrep` with `--baseline-commit "$(git merge-base origin/main HEAD)"` for
  SAST, `osv-scanner` over the npm and pip manifests, `trivy config` over the
  Dockerfiles and other config, and `actionlint` plus `zizmor` over the
  workflows. Scanners are installed as **pinned CLI downloads**, not marketplace
  actions — this is the security workflow, so it is where third-party action
  supply-chain exposure matters most. Terraform is not scanned here because it
  is not in this repository; it lives in the private `resonate-iac` repo.
  Pre-existing findings must never block a pull request that did not introduce
  them — that is what a baseline is for, and a pipeline that fails on inherited
  debt trains people to ignore it.
- **`Nightly Security Scan (advisory)`** covers what diff-scoped scanning
  structurally cannot: full-tree SAST with no baseline, and
  `trufflehog --results=verified` over the whole git history. That second one is
  the direct answer to the open question in #1539 — whether a secret has already
  leaked through this repository's history. A verified hit is a real,
  currently-valid credential: **rotate first**, then clean up. Output goes to a
  digest and an artifact, not to a pull request.
- **`code-review.yml`** was **retired** (#1547). It ran
  `anthropics/claude-code-action@v1` against a repository `ANTHROPIC_API_KEY`,
  which is billed separately from a Claude subscription. It had also been
  failing on every pull request since 2026-07-19 — rejected before any review
  ran — so for three weeks it produced a red check and no review at all.
  Reviews now run locally with `/code-review`, which uses the developer's own
  Claude Code session rather than a hosted key. Extending a hosted review with
  `security-review` is off the table while there is no key to run it with; the
  security scans in `security.yml` are unaffected and still run in CI.
- **`certora.yml` / `formal.yml` / `mutation.yml`** are already wired and do not
  change. They implement the formal and mutation layers of the contract test
  ladder; `security-smart-contracts` is the doctrine they cite, not a step they
  execute.

### Promotion criteria

The ratchet rule: a new check never lands as required. `security.yml` stays
fully advisory for **two to four weeks** from landing, tuned against real pull
requests. A step may be proposed for promotion to a required check only when all
of the following hold:

1. its false-positive rate **on this repository** has been measured over real
   pull requests and is small;
2. the existing findings it reports are baselined or fixed, so it fails only on
   what a branch introduces — the first `gitleaks dir .` run over this working
   tree returned **24 findings**, all test fixtures, well-known Anvil keys, and
   mock JWTs, which is exactly the inherited debt a baseline exists for;
3. a human makes the ruleset change deliberately — adding a required check
   edits the `main` branch protection ruleset and is never done by a workflow.

Secrets are the first candidate for promotion, because they are the near-zero
false-positive class and a secret that reaches the remote is unrecoverable.

### Pre-commit (opt-in)

`.pre-commit-config.yaml` exists but is **not installed for you** and is not
enforced anywhere. It holds only what fits a five-second budget: `gitleaks` on
the staged diff, `detect-private-key`, and `actionlint` on changed workflow
files. Formatters are deliberately excluded — this repo has no enforced
repo-wide formatter config, and adding one would mean a mass reformat; per-package
`eslint` via `lint-staged` keeps that job.

Husky owns `core.hooksPath` for `lint-staged`, so plain `pre-commit install`
refuses to run. Use it on demand:

```bash
pre-commit run --all-files
```

or chain it from the existing husky hook by adding
`pre-commit run --hook-stage pre-commit` to `.husky/pre-commit`.

## The split rule

**Deterministic scanners can block CI. Judgment-driven LLM skills stay
advisory.**

A scanner is fast, free, and reproducible: the same commit produces the same
verdict every time, so a failure is a fact the author can act on. An LLM review
is none of those things. Run-to-run instability makes a model verdict unfit to
gate a merge, and the first time a gate fails on a commit that passed an hour
ago it loses its authority for good — after which every subsequent finding,
including the true ones, gets waved through.

So: `security-scan` output can be required; `security-review`, `security-audit`,
`security-threat-model`, `security-ai`, and `security-supply-chain` output is
posted, read, and decided on by a human. This also keeps the merge queue from
being wedged by a model outage or a billing failure.

## Related

- [AI Skills Marketplace](../ai-skills-marketplace.md) — Trail of Bits plugin
  recommendations and the migration mapping for the retired workflows.
- [Change Impact Checklist](change_impact_checklist.md) — the cross-functional
  review to run before finishing durable work.
- [`agent-toolkit`](https://github.com/akoita/agent-toolkit) — the shared
  skills, their READMEs, and install/update/uninstall guides.
- `AGENTS.md` — project coding standards, including the smart contract test
  ladder and testing conventions.
</content>
