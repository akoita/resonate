---
description: Scan Solidity contracts for vulnerabilities — 4-phase audit workflow adapted from Trail of Bits' scv-scan
---

# Smart Contract Vulnerability Scan

Systematically audit the Solidity codebase in `contracts/` for vulnerabilities using a four-phase approach.

> Adapted from [Trail of Bits scv-scan](https://github.com/trailofbits/skills-curated/tree/main/plugins/scv-scan). Licensed under their original terms.

## When to use

- Before deploying or upgrading `StemNFT`, `StemMarketplaceV2`, or any new contract
- After modifying contract logic, access control, or token flows
- When reviewing PRs that touch `contracts/`

## Phase 1 — Reconnaissance

1. List all `.sol` files in `contracts/src/`:
   ```
   find contracts/src -name '*.sol' -type f
   ```
2. Note the Solidity pragma version in each — many vulnerabilities are version-dependent (e.g. overflow is checked by default ≥0.8.0)
3. Identify external dependencies (OpenZeppelin, custom libraries)

## Phase 2 — Codebase Sweep

Perform two complementary passes:

### Pass A: Syntactic grep scan

Search for known trigger patterns using `grep` or `ripgrep`:

```
# Reentrancy triggers
rg '\.call\{' contracts/src/
rg '_safeMint\|_safeTransfer\|safeTransferFrom' contracts/src/

# Access control
rg 'onlyOwner\|onlyRole\|_checkRole\|require.*msg\.sender' contracts/src/

# Dangerous patterns
rg 'selfdestruct\|delegatecall\|tx\.origin' contracts/src/

# Unchecked blocks
rg 'unchecked' contracts/src/

# Assembly
rg 'assembly' contracts/src/
```

For each match, record: file, line number(s), matched pattern, suspected vulnerability type.

### Pass B: Semantic analysis

Read through the contracts looking for logic issues that don't grep well:

- Cross-function reentrancy
- Missing access control on state-changing functions
- Incorrect inheritance order
- Unsafe external calls without checks
- Missing `initializer` modifier on upgradeable contracts

### Compile candidate list

Merge Pass A and Pass B into a deduplicated list:

```
- File: `path/to/file.sol` L{start}-L{end}
- Suspected: [vulnerability-name]
- Evidence: [brief description]
```

## Phase 3 — Deep Validation

For each candidate:

1. **Trace the full call chain** — follow variable values, check modifiers, trace across contracts
2. **Check false positive conditions** — if the pattern appears but isn't exploitable, discard with a note
3. **Cross-reference** — one code location can have multiple vulnerability types
4. **Confirm or discard** — only confirmed findings go into the report

### Rationalizations to reject (beware!)

- "The compiler is ≥0.8.0 so overflow isn't possible" — `unchecked` blocks, assembly, and type downcasts still wrap
- "It uses OpenZeppelin so it's safe" — integration bugs, missing modifiers on custom functions are common
- "That function is internal" — internal functions called from external entry points inherit caller context
- "No ETH involved so reentrancy doesn't apply" — ERC721 `_safeMint`, ERC1155 safe transfers trigger callbacks
- "It's upgradeable so we can fix later" — `initialize()` without `initializer` is itself a critical vuln

## Phase 4 — Report

For each confirmed finding, output:

```markdown
### [Vulnerability Name]

**File:** `path/to/file.sol` L{start}-L{end}
**Severity:** Critical | High | Medium | Low | Informational

**Description:** What is vulnerable and why.

**Code:**
[vulnerable snippet]

**Recommendation:** Specific fix.
```

Write the report to `audit/scv-scan-report.md` (create the `audit/` directory if it doesn't exist) and print a summary table:

| Severity | Count |
| -------- | ----- |
| Critical | N     |
| High     | N     |
| Medium   | N     |
| Low      | N     |
| Info     | N     |

### Severity guidelines

- **Critical**: Direct loss of funds, unauthorized extraction, permanent freezing
- **High**: Conditional fund loss, access control bypass, exploitable state corruption
- **Medium**: Unlikely fund loss, griefing, DoS on non-critical paths
- **Low**: Best practice violations, gas inefficiency, no direct exploit
- **Informational**: Unused variables, style issues, documentation gaps
