# Certora Verification

Certora specs are reserved for high-value protocol properties that need
independent formal verification beyond Forge unit, fuzz, invariant, and Halmos
checks.

## Layout

- `conf/` - Prover configuration files, one file per verification target.
- `specs/` - CVL specifications, named after the target contract or protocol
  surface.

## Expected Targets

Use Certora Prover for custody, accounting, authorization, upgrade, and
state-machine properties where a CVL spec gives clearer assurance than a
Foundry-style symbolic test.

Use Certora Gambit mutation testing to evaluate whether the CVL spec or test
suite catches intentionally injected faults. Live mutants should become new
tests, stronger invariants, or stronger CVL rules.

## Commands

```bash
# Example shape once a config exists
certoraRun certora/conf/show_campaign_escrow.conf

# Mutation testing is configured per target/spec.
gambit --help
```

Do not add empty placeholder specs as a PR gate. When a spec is deferred,
document the exact deferred property in the PR summary or feature plan.
