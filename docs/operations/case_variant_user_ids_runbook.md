---
title: "Case-Variant User Ids Runbook"
status: living
owner: "@akoita"
issue: 2180
---

# Case-Variant User Ids Runbook

Wallet and passkey accounts use their smart-account address as the user id, and
sign-in stores it **lowercase**. Before the id was normalised at every creation
point (#2180), a checksummed spelling of the same address could create a second
`User` (and a second wallet) for one person. Today every path that creates or
looks up a user from an address-derived id lowercases it first, so no new
duplicates appear. Existing ones are found with the report below.

This page covers **finding** duplicates (the report) and **merging** them (the
merge script, dry-run first). The merge moves history between accounts, so it
is always preceded by a review of the dry-run result.

## What counts as a case variant

Two `User` ids that are equal under lowercase, for example `0xabc...` and
`0xAbC...`. The admin users directory (`/admin/users`) marks both with a
"Possible duplicate" chip.

## Run the report

The script is read-only and boots no application: it needs a database URL in
`DATABASE_URL` and nothing else. Get the connection details for the environment
you are reviewing from the deployment runbooks (private) and run it from a
machine that is allowed to reach that database.

```bash
cd backend
DATABASE_URL='<postgres url>' npm run identity:report-case-variants
# or, from a built image:
DATABASE_URL='<postgres url>' node dist/scripts/report_case_variant_users.js
```

The log line `identity.case_variant_users.report` carries **counts only**:
number of groups, users involved, how many variants are lowercase or mixed
case, columns scanned, rows that reference the variants, and how many tables
those rows are in. It never prints an id, because the ids are wallet addresses.
Exit code `0` means the report completed (including "no duplicates"); `1` means
it could not run.

### Per-group detail

To see which ids are involved and what references each one, write the detail to
a local file:

```bash
DATABASE_URL='<postgres url>' npm run identity:report-case-variants -- \
  --details-file ./case_variants.json
```

The file (permissions `0600`) lists each group by its lowercase key and, per
variant: the id, its casing class (`lowercase` or `mixed`), when it was created,
and the number of rows referencing it per `Table.column`. References are every
single-column foreign key to `"User"."id"`, read from the database catalog, plus
the relation-less person-id columns in the privacy erasure manifest's
`DANGLING_PERSON_COLUMNS`.

The file contains wallet addresses, which are personal data. Keep it on the
machine that produced it, do not attach it to an issue or a chat, and delete it
when the review is done.

## Reading the result

- A group where one variant has no references is a stray row created by a
  checksummed lookup; the other variant is the account the person actually uses.
- A group where both variants have wallet, purchase or pledge rows needs a
  reviewed merge. Record the group count and the reference totals (counts only)
  on the issue and plan the merge there.

## Size the merge: summary mode

`--summary` adds one log line per referencing column,
`identity.case_variant_users.report.reference`, with the number of rows pointing
at lowercase variants and at mixed-case variants (aggregated over all groups,
counts only, no ids):

```bash
DATABASE_URL='<postgres url>' npm run identity:report-case-variants -- --summary
```

The expected shape is that every group has one lowercase variant (the account
people sign in with, holding the history) and one mixed-case variant (an orphan
that holds little or nothing). If many rows point at mixed-case variants in
tables that hold money, credits or purchases, review those groups before merging.

## Merge

`merge_case_variant_users` moves every reference to the mixed-case variant onto
the lowercase user, then deletes the variant `User`. Like the report it needs only
`DATABASE_URL` and boots no application.

1. **Dry-run (the default).** Nothing is written unless `--apply` is given.

   ```bash
   cd backend
   DATABASE_URL='<postgres url>' npm run identity:merge-case-variants -- \
     --details-file ./case_variant_plan.json
   ```

   The plan runs inside transactions that are always rolled back, so the
   outcome per group is what `--apply` would do. Logs carry counts and reason
   classes only: `identity.case_variant_users.merge.moved` (rows per
   `Table.column`), `.deleted` (duplicate rows dropped per table), `.manual`
   (groups needing a decision, with the reason class and `Table.column`), and
   the `identity.case_variant_users.merge` totals. The details file (`0600`)
   lists every group with its ids, outcome, and per-column counts; keep it
   local and delete it afterwards, as for the report.

2. **Review.** Every group should be `merged` or an expected `manual`. Do not
   apply while a `manual` reason surprises you.

3. **Apply**, optionally a few groups first with `--limit N`:

   ```bash
   DATABASE_URL='<postgres url>' npm run identity:merge-case-variants -- --apply --limit 5
   DATABASE_URL='<postgres url>' npm run identity:merge-case-variants -- --apply
   ```

   Each group is its own transaction: it either merges completely or not at
   all, so an interrupted or failed run leaves no half-merged group. The script
   is idempotent; a merged group never reappears.

4. **Re-report.** Run the report again; the merged groups are gone. What is left
   is exactly the `manual` groups.

Exit codes: `0` ok (including "no duplicates"), `1` could not run or bad
arguments, `2` at least one group needs a manual decision.

### What the script decides, and what it leaves to you

The canonical user is the all-lowercase id. A row that would collide with a
canonical row on a unique key is resolved by policy; the only rows the script
ever deletes (besides the variant `User`) are these duplicates:

| Situation | Policy |
| --- | --- |
| 1:1 row (unique on the user alone: `Wallet`, profile, settings, credit account, ...) held by both users | Keep the canonical row. Drop the variant's only if none of its money-like numeric columns (balance, usd, cents, price, ...) is non-zero; a `Wallet` must also have the same address ignoring case. |
| Composite-unique row (user plus another key, e.g. a read marker) held by both users | Drop the variant's duplicate only if no money-like column differs from the canonical row's. |
| A row to drop has dependent rows in another table | `manual`. |
| Any other unique conflict, partial or expression index, or database error | Whole group rolled back, `manual`. |

A group is also `manual` when it has no lowercase member, more than two members,
an erased canonical user, or a variant that is erased, closed or not `active`.
After the moves the variant must have zero references left, else the group is
rolled back and `manual`.

Resolve a `manual` group by hand, from the details file: decide which account
holds the real balance or history, move or reconcile it through the normal
product paths, then re-run the script. Reason classes are listed in
`backend/src/scripts/merge_case_variant_users.ts`.

Deployment wiring (where this runs, which credentials) is private; see the
deployment runbooks.
