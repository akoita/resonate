# AI Skills Marketplace — Trail of Bits Curated Plugins

> Vetted Claude Code plugins from [Trail of Bits' Curated Skills](https://github.com/trailofbits/skills-curated).
> Every skill is code-reviewed by Trail of Bits staff to prevent backdoors and malicious hooks.

## Installation

> [!NOTE]
> These plugins require **Claude Code**. The `/plugin` commands below are Claude Code-specific.

```
/plugin marketplace add trailofbits/skills-curated
/plugin menu
```

After adding the marketplace, use `/plugin menu` to browse and install individual plugins.

---

## Antigravity Workflows (Agent-Agnostic)

The three highest-priority security skills have been ported to `.agents/workflows/` and work with **any** AI coding agent (Antigravity, Copilot, etc.):

| Slash command              | What it does                                                  | Source                           |
| -------------------------- | ------------------------------------------------------------- | -------------------------------- |
| `/smart-contract-scan`     | 4-phase Solidity vulnerability audit of `contracts/`          | `scv-scan`                       |
| `/security-best-practices` | Security review of backend + frontend with prioritized report | `openai-security-best-practices` |
| `/security-threat-model`   | AppSec-grade threat model anchored to actual code             | `openai-security-threat-model`   |

---

## Recommended Plugins

### ⭐ Critical — Smart Contract Security

| Plugin                           | What it does                          | Why we need it                                                                                                                         |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `scv-scan`                       | Smart contract vulnerability scanning | Directly scans our Solidity contracts (`StemNFT`, `StemMarketplaceV2`) for known vulnerability patterns                                |
| `evmbench`                       | AI-driven smart contract auditing     | OpenAI × Paradigm benchmark — deep semantic analysis complementing pattern-based scans ([evaluation](../audit/evmbench-evaluation.md)) |
| `openai-security-best-practices` | General security best practices       | Enforces secure coding patterns across backend and frontend                                                                            |
| `openai-security-threat-model`   | Threat modeling assistance            | Valuable for our account abstraction layer, agent-owned keys, and wallet security                                                      |

### 👍 Recommended — Development Workflow

| Plugin                          | What it does                 | Why it helps                                                |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `openai-security-ownership-map` | Security ownership mapping   | Maps who owns what across our codebase — useful for reviews |
| `openai-gh-fix-ci`              | Diagnose and fix CI failures | Speeds up fixing our GitHub Actions pipeline                |
| `openai-gh-address-comments`    | Address PR review comments   | Streamlines the code review cycle                           |
| `security-awareness`            | Security awareness guidance  | General security hygiene reminders                          |

### 💡 Optional — Situational Use

| Plugin                | What it does                      | When to use                                                                     |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `planning-with-files` | Structured file-based planning    | Complex multi-phase features (we partially cover this with `.agents/workflows/`) |
| `openai-playwright`   | Playwright test generation        | When writing new E2E tests (we already use Playwright)                          |
| `ffuf-web-fuzzing`    | Web fuzzing with ffuf             | Security audits on API endpoints                                                |
| `humanizer`           | Humanize AI-generated text        | Documentation and content writing                                               |
| `last30days`          | Research last 30 days of activity | Market research and trend analysis                                              |

### ⏭️ Not Recommended

| Plugin                   | Reason                                               |
| ------------------------ | ---------------------------------------------------- |
| `ghidra-headless`        | Reverse engineering — not relevant to our stack      |
| `wooyun-legacy`          | Chinese legacy vuln database — limited applicability |
| `x-research`             | X/Twitter research — niche, not a primary need       |
| `python-code-simplifier` | Python-specific — our stack is TypeScript/Solidity   |
| `react-pdf`              | PDF generation — no current requirement              |
| `skill-extractor`        | Skill extraction from repos — meta-tooling           |

---

## Custom Skill Opportunities

Gaps where we could create project-specific skills or contribute back:

1. **Solidity/Foundry testing** — A skill for running `forge test` with pattern-based analysis of failures
2. **NestJS module scaffolding** — Generate NestJS modules/services following our conventions from `AGENTS.md`
3. **Prisma migration checker** — Validate schema changes and generate migration scripts
4. **Account abstraction patterns** — Codify our passkey-first AA patterns for consistent implementation

---

## References

- [Trail of Bits Curated Skills repo](https://github.com/trailofbits/skills-curated)
- [OpenAI Skills source repo](https://github.com/openai/skills) (original, before Trail of Bits conversion)
- Related issue: [#353](https://github.com/akoita/resonate/issues/353)
