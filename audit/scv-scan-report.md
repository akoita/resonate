## Smart Contract Scan Report

Scope reviewed on April 8, 2026:

- `contracts/src/core/DisputeResolution.sol`
- `contracts/script/DeployLocalAA.s.sol`
- `contracts/test/unit/DisputeResolution.t.sol`
- `contracts/test/unit/CurationRewards.t.sol`

### Reconnaissance

- Solidity version: `0.8.28`
- Key inherited dependencies:
  - OpenZeppelin `Ownable`
  - OpenZeppelin `ReentrancyGuard`
- Change focus:
  - prevent the same reporter wallet from re-filing the same token after resolution
  - update local AA deployment operator instructions

### Syntactic Sweep

Patterns reviewed:

- access control via `onlyOwner`
- state transitions around `fileDispute`, `resolve`, and `finalizeJuryDecision`
- external-call and callback triggers such as `.call{}`, `delegatecall`, `_safeMint`, `safeTransferFrom`
- unsafe primitives such as `tx.origin`, `selfdestruct`, `unchecked`, and `assembly`

Observed result:

- no new external-call surfaces were introduced
- no new unchecked arithmetic or inline assembly was introduced
- the new `hasReportedByToken` guard only adds state validation before dispute creation

### Semantic Review

Reviewed the new `AlreadyReported` flow for:

- accidental permanent lock of unrelated reporters
- bypass via appeal or jury flow
- stale active-dispute state after resolution

Conclusion:

- the new mapping is keyed by `tokenId` and `reporter`, so it blocks only repeat filings by the same wallet for the same token
- `activeDisputeByToken` is still cleared on resolution and jury finalization, so different reporters can still file later cases
- the change does not alter fund-handling or access-control paths

### Findings

No confirmed Critical, High, Medium, Low, or Informational security findings were identified in the reviewed changes.

| Severity | Count |
| -------- | ----- |
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Low      | 0 |
| Info     | 0 |
