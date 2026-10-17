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

This page covers **finding** duplicates. Merging them is a separate, reviewed
step (it moves money and history between accounts) and is not done by any script
here.

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
