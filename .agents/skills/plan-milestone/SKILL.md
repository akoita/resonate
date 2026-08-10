---
name: plan-milestone
description: >-
  Compose the next Resonate milestone (Vision Sprint) — select and balance open
  issues against the fixed selection criteria (business value, usability, known
  issues, new needs), then propose and, once approved, create the GitHub
  milestone. Use when the user says "new milestone", "next sprint", "plan the
  milestone", "what should go in the next sprint", or asks which issues to pull
  in next. Do not use to start or finish work on a single issue — see
  start-issue and finish-issue.
---

# Plan a milestone

Compose the next milestone for this repo. The selection criteria below are
fixed — never ask the user to restate them.

## Selection criteria

A milestone is judged on four axes. **An ideal milestone mixes all four**,
weighted by current project state, roadmap and vision — not a pile from one
axis.

1. **Business value** — moves the needle for at least one of: end user, app
   owner, investors. Name which one, per issue.
2. **Usability** — new feature, UX, DX, or agent experience (AX).
3. **Known issues** — fix what is already reported and understood.
4. **New needs** — analyse evolutions, open questions, strategy. Investigation
   and design work is legitimate milestone work.

Rejection signals: an issue that maps to none of the four; a value statement
that amounts to "it's on the backlog"; a milestone that is 100% one axis
(usually all bug-fixes, or all new features with zero debt paydown).

## Context to load first

The right mix depends on where the project actually is. Read before selecting:

- `docs/roadmap/` — the latest roadmap doc holds the locked theme, the window,
  and what is explicitly out of scope.
- Milestone history, for naming continuity and carry-over:
  `gh api "repos/:owner/:repo/milestones?state=all&per_page=100" --jq '.[]|[.number,.state,.title]|@tsv'`
- The open milestone, if any — carry-over is decided before new work is added.
- The production-readiness ledger, if one is open (e.g. issue #1595, which
  operationalizes `docs/roadmap/2026-07-production-readiness-triage.md`) — it
  feeds the "known issues" and "business value" axes; pull from it first.
- `AGENTS.md` for engineering constraints and house rules.

Shell note: this repo enforces WSL-only execution on Windows hosts. When the
Bash tool runs on the Windows side, wrap commands as
`wsl.exe -d ubuntu-24.04 -- bash -lc '<cmd>'`.

## Procedure

1. **Snapshot state.** Open milestone and its unfinished issues, last closed
   milestone, current roadmap window. Unfinished work in the open milestone is a
   carry-over candidate and is decided first.
2. **Pull the candidate pool.**
   `gh issue list --state open --limit 200 --json number,title,labels,milestone,updatedAt`
   Prefer issues with no milestone; flag any already assigned elsewhere.
3. **Classify** each serious candidate against the four axes, with a one-line
   value statement naming the beneficiary (end user / app owner / investors).
4. **Balance the mix.** Aim for coverage of all four axes. If an axis ends up
   empty, say so explicitly and justify it from roadmap state rather than
   silently shipping a lopsided milestone.
5. **Write a sprint goal** — one sentence, outcome-shaped, not a list of issues.
   Follow the existing naming convention: `Vision Sprint N: <theme>`.
6. **Define exit criteria** per workstream — observable, not "done".
7. **Name what is out of scope**, so the milestone has an edge.
8. **Propose before creating.** Present the draft and get an explicit yes.
   Creating the milestone and reassigning issues are GitHub-visible writes —
   never do them unprompted.

## Output shape

```
## Vision Sprint N: <theme>

**Sprint goal:** <one sentence>
**Window:** <dates, or "no due date until the window is agreed">
**Carry-over:** <issues, or "none">

| Axis | Issue | Beneficiary | Why now | Exit criteria |
|---|---|---|---|---|

**Not in this milestone:** <explicit exclusions>
**Mix check:** <one line on axis coverage, plus any gap and its justification>
```

## Creating it, once approved

```bash
gh api repos/:owner/:repo/milestones -f title='Vision Sprint N: <theme>' -f description='<description>'
gh issue edit <n> --milestone 'Vision Sprint N: <theme>'
```

Milestone descriptions in this repo state the carry-over source, the objectives
in prose, and the due-date status. Follow that shape.
