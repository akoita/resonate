---
title: "RFC: Content Protection Architecture — Decentralized IP Verification"
status: draft
author: "@akoita"
created: "2026-03-03"
---

# RFC: Content Protection Architecture — Decentralized IP Verification

## Abstract

This RFC defines Resonate's defense system against unauthorized content publication. On a decentralized platform without intermediaries, the question _"does this uploader actually own this content?"_ cannot be delegated to a distributor. This document specifies a multi-layered, crypto-economically incentivized protection system that replaces centralized gatekeeping with verifiable proofs, economic deterrents, and community governance.

> [!IMPORTANT]
> This is not a feature — it is a **platform pillar**. Without credible IP protection, Resonate cannot attract legitimate artists, and without legitimate artists, there is no platform. Every design decision in this RFC prioritizes _making theft economically irrational_ over _making theft technically impossible_ (which is unsolvable in any system, centralized or not).

---

## Motivation

### The Fundamental Tension

| Goal              | Requirement                               | Conflict                                     |
| ----------------- | ----------------------------------------- | -------------------------------------------- |
| Decentralization  | No gatekeepers, permissionless publishing | Anyone can upload anything                   |
| Artist protection | Revenue goes to rightful owners only      | Need to verify ownership without a middleman |
| Frictionless UX   | Artists upload directly, no 3-week wait   | Can't hold everything for manual review      |

### What Traditional Platforms Do (And Why We Can't)

- **Spotify / Apple Music:** Delegate IP verification to distributors (DistroKid, TuneCore). The distributor vouches for the artist. This is effective but reintroduces the exact intermediary Resonate eliminates.
- **YouTube:** Built Content ID for ~$100M. Scans every upload against a database of 100M+ reference files. Effective but centralized, opaque, and frequently abused (false claims on original content).
- **SoundCloud:** Uses Audible Magic for fingerprinting. Catches major-label content but misses independent works.

### What Resonate Must Do Instead

Build a **decentralized content protection system** that:

1. Detects known copyrighted works automatically (fingerprinting)
2. Deters fraud economically (staking + delayed payouts)
3. Incentivizes community vigilance (curation bounties)
4. Provides cryptographic proof of authorship (on-chain provenance)
5. Resolves disputes fairly without centralized authority
6. Maintains legal safe harbor for the platform (DMCA compliance)

---

## Foundational Principle: Full Track as Protection Anchor

> [!IMPORTANT]
> **All content protection gates at the full track level, not the stem level.** The full track is the entry point where content enters the platform. Stems are generated server-side by Demucs and inherit their parent track's verification status.

This principle follows directly from the [Business Model RFC](./business-model.md):

> _"Full tracks are the storefront. Stems are the product."_

### The Two-Asset Model

| Asset          | How It Enters the Platform         | IP Risk                                             | Protection Anchor              |
| -------------- | ---------------------------------- | --------------------------------------------------- | ------------------------------ |
| **Full Track** | Artist uploads directly            | **High** — someone can upload a song they don't own | ✅ Primary verification target |
| **Stems**      | Generated server-side by Demucs AI | **Inherited** — if track is legit, stems are legit  | Inherits from parent track     |

### Why This Matters

1. **Fingerprinting is most effective on full tracks.** Commercial databases (AcoustID, MusicBrainz) contain ~45M full tracks, but almost zero isolated stems. Matching a full Drake song is trivial; matching an isolated bass stem is nearly impossible.

2. **The artist never uploads stems directly.** The pipeline is: `Upload full track → Demucs separates → Stems created server-side`. The chain of custody is controlled by the platform.

3. **Staking and attestation happen once per release, not per stem.** A 12-track album requires one stake and one attestation, not 72 (12 tracks × 6 stems each). This dramatically reduces friction.

4. **Disputes cascade.** If a full track is confirmed stolen → all 6 derived stems are automatically delisted. No need to dispute each stem individually.

### Verification Inheritance Chain

```
Full Track (uploaded by artist)
  ├── Fingerprinted against AcoustID + internal DB
  ├── Attested + staked by creator wallet
  ├── Challenge period (earnings escrowed)
  │
  └── Demucs Separation (server-side, after verification passes)
       ├── Vocals stem  ──► inherits track verification status
       ├── Drums stem   ──► inherits track verification status
       ├── Bass stem    ──► inherits track verification status
       ├── Guitar stem  ──► inherits track verification status
       ├── Piano stem   ──► inherits track verification status
       └── Other stem   ──► inherits track verification status
```

### Revenue Escrow Scope

The escrow applies to **all revenue generated by the release** — both full-track streaming micropayments (Layer 1/2 from the Business Model) and stem licensing fees (Layer 3):

| Revenue Source              | Escrow Applies?      | Rationale                                          |
| --------------------------- | -------------------- | -------------------------------------------------- |
| Free streaming (Layer 1)    | No revenue to escrow | Free tier generates no artist revenue              |
| Pro micropayments (Layer 2) | ✅ Yes               | Per-play payments escrowed during challenge period |
| Stem licensing (Layer 3)    | ✅ Yes               | License fees escrowed during challenge period      |
| Remix royalties             | ✅ Yes               | Ancestry-based royalties also escrowed             |

---

## Architecture Overview

```
                        ┌──────────────────────────────────────────────────────┐
                        │              FULL TRACK UPLOAD PIPELINE              │
                        │                                                      │
Full Track ──► Fingerprint ──► Match? ──YES──► QUARANTINE ──► Review           │
Upload              │                                                          │
                    NO                                                         │
                    │                                                          │
                    ▼                                                          │
         ┌──────────────────┐                                                  │
         │  ATTESTATION     │  Wallet signature +                              │
         │  + STAKE LOCK    │  Token deposit locked (per release)              │
         └────────┬─────────┘                                                  │
                  │                                                            │
                  ▼                                                            │
         ┌──────────────────┐                                                  │
         │  DEMUCS          │  AI stem separation (server-side)                │
         │  SEPARATION      │  Stems inherit track verification               │
         └────────┬─────────┘                                                  │
                  │                                                            │
                  ▼                                                            │
         ┌──────────────────┐                                                  │
         │  CHALLENGE PERIOD│  7–30 days (based on trust tier)                 │
         │  Track + Stems   │  ALL earnings ESCROWED (streaming + licensing)   │
         │  are LIVE        │                                                  │
         └────────┬─────────┘                                                  │
                  │                                                            │
        ┌─────────┼──────────┐                                                 │
        │         │          │                                                 │
     No dispute   │     Dispute filed                                          │
        │         │          │                                                 │
        ▼         │          ▼                                                 │
     Stake        │    ┌───────────────┐                                       │
     returned     │    │ ADJUDICATION  │  Evidence review                       │
     Earnings     │    │ (Decentralized│  Fingerprint comparison                │
     unlocked     │    │  or Platform) │  On-chain timestamp check              │
                  │    └──────┬────────┘                                        │
                  │      ┌────┴────┐                                           │
                  │   Upheld    Rejected                                       │
                  │      │         │                                           │
                  │      ▼         ▼                                           │
                  │   Takedown   Reporter                                      │
                  │   Track +    counter-stake                                 │
                  │   ALL stems   slashed                                      │
                  │   removed    (anti-spam)                                   │
                  │   Creator                                                  │
                  │   blacklisted                                              │
                  │                                                            │
                  └──────────────────────────────────────────────────────────── ┘
```

---

## 1. Upload-Time Verification (Automated Detection)

> [!NOTE]
> All automated detection operates on the **full track** — the original audio file uploaded by the artist. Stems are generated server-side after verification passes and are not independently fingerprinted.

### 1.1 Audio Fingerprinting (Full Track)

Every uploaded full track is fingerprinted **before stem separation begins**. The fingerprint is a compact acoustic signature derived from the audio waveform — not metadata, not filename — the actual sound.

| Technology                 | Coverage                    | License    | Integration                                      |
| -------------------------- | --------------------------- | ---------- | ------------------------------------------------ |
| **Chromaprint** (AcoustID) | ~45M tracks via MusicBrainz | LGPL       | Python bindings, trivial to add to Demucs worker |
| **Dejavu**                 | Custom internal database    | MIT        | Python, good for internal duplicate detection    |
| **Audd.io** (API)          | Major commercial catalog    | Commercial | REST API, pay-per-query                          |
| **Audible Magic**          | Major label catalog         | Enterprise | SDK, expensive (SoundCloud uses this)            |

**Why full tracks over stems?** Commercial fingerprint databases contain full songs, not isolated stems. A full Drake song is trivially matched against AcoustID; an isolated bass stem would produce no match. By fingerprinting at the full-track level, we leverage the entire existing catalog of known works.

**Recommended approach:**

- **Phase 1:** Chromaprint + internal DB (open-source, immediate)
- **Phase 2:** Audd.io API for commercial catalog coverage (paid, higher accuracy)
- **Future:** Audible Magic if/when scale justifies enterprise cost

**Integration point:** The fingerprinting step runs **before** Demucs stem separation. If a match is found, the track is quarantined and stems are never generated:

```
Full Track Upload → Validation → Fingerprint Full Track → Match Check → ✅ Passed?
                                                               │              │
                                                           Match found    No match
                                                               │              │
                                                               ▼              ▼
                                                          QUARANTINE    Demucs Separation
                                                          (no stems     → Encryption
                                                           generated)   → Storage
                                                                        → Stems inherit
                                                                          track status
```

### 1.2 Metadata Cross-Reference

Beyond audio fingerprinting, cross-reference upload metadata against public databases:

- **ISRC** (International Standard Recording Code) — if the uploader provides an ISRC, verify it against the ISRC registry
- **ISWC** (International Standard Musical Work Code) — for composition-level verification
- **MusicBrainz** — open metadata database for title/artist matching

### 1.3 Duplicate Detection (Internal)

Every new full-track fingerprint is compared against **all existing tracks on Resonate**. If the same audio (or a near-match above 85% similarity) already exists on the platform:

- If uploaded by the **same wallet** → warn (possible re-upload)
- If uploaded by a **different wallet** → quarantine + notify original uploader
- If a quarantined track is confirmed stolen → **no stems are ever generated** (saving processing resources)

Additionally, stem-level fingerprints are computed _after_ Demucs separation and stored for future cross-reference. This enables detecting cases where someone uploads a different full track but one of its stems matches an existing stem (e.g., same vocal sample used in two different beats).

### 1.4 AI-Assisted Similarity Detection (Future)

For content that bypasses fingerprinting (e.g., re-recorded covers, pitch-shifted copies):

- Train a similarity model on the full-track corpus and, separately, on the stem corpus
- Full-track similarity catches re-masters, pitch shifts, and speed changes
- Stem-level similarity catches reused vocal takes, drum loops, or bass lines in otherwise different tracks
- This is not a blocker for launch but a competitive moat long-term

---

## 2. Economic Deterrents

### 2.1 Stake-to-Publish

To publish content on Resonate, the creator must **lock a stake per release** (not per stem) in a smart contract. A release may contain one track (single) or many tracks (album). The stake covers the entire release and all stems derived from it.

| Trust Tier              | Required Stake (per release) | Rationale                               |
| ----------------------- | ---------------------------- | --------------------------------------- |
| New creator (0 uploads) | 0.01 ETH (~$25)              | High enough to deter mass-upload bots   |
| Established (5+ clean)  | 0.005 ETH (~$12)             | Reduced friction for proven creators    |
| Trusted (50+ clean)     | 0.001 ETH (~$2.50)           | Minimal friction, strong track record   |
| Verified artist         | 0 (waived)                   | Proof-of-humanity + social verification |

**Stake lifecycle:**

1. Creator deposits stake when uploading a release (covers all tracks + derived stems)
2. Stake is locked during the challenge period
3. If no disputes → stake returned in full after challenge period ends
4. If dispute upheld on any track in the release → stake slashed for entire release

**Slash distribution:**

- 60% → Reporter (bounty incentive)
- 30% → Platform treasury (operational costs of dispute resolution)
- 10% → Burned (deflationary pressure)

### 2.2 Delayed Earnings Access (Revenue Escrow)

This is critical. Even if a bad actor bypasses fingerprinting, **they cannot access earnings immediately.**

| Trust Tier      | Escrow Period | Rationale                                              |
| --------------- | ------------- | ------------------------------------------------------ |
| New creator     | 30 days       | High risk window — most disputes happen within 2 weeks |
| Established     | 14 days       | Shorter wait, earned through clean history             |
| Trusted         | 7 days        | Minimal delay for proven creators                      |
| Verified artist | 3 days        | Near-instant, but still allows emergency takedowns     |

**During escrow:**

- Earnings accumulate in a smart contract escrow
- If a dispute is filed, earnings are **frozen** until resolution
- If the dispute is upheld, escrowed earnings are redirected to the rightful owner (if they can be identified) or to the platform treasury
- If no dispute is filed, earnings release automatically after the escrow period

**Why this is powerful:** A content thief can upload a hit song, generate streams, but **never actually access the money** if caught within the escrow window. The incentive to steal collapses.

### 2.3 Progressive Penalties

| Offense             | Consequence                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| 1st confirmed theft | Stake slashed, content removed, 90-day "probation" (higher stake required) |
| 2nd confirmed theft | All stakes slashed, all escrowed earnings forfeited, 1-year publishing ban |
| 3rd confirmed theft | Permanent wallet blacklist, all content delisted                           |

The wallet blacklist is stored on-chain (in the `ContentProtection` contract) and is **permanent and public**. Other platforms can query it.

---

## 3. Community Curation & Bounty System

### 3.1 The Curation Incentive Model

Every Resonate user can participate in content verification. This creates a **decentralized Content ID** powered by human attention and economic incentives.

**How it works:**

1. Any user can **flag a track or release** as potentially stolen (disputes target the full track; if upheld, all derived stems are delisted)
2. The reporter must provide:
   - Link to the alleged original source (YouTube, Spotify, SoundCloud, etc.)
   - Short description of the claim
   - A **counter-stake** (small deposit proving they're serious, not spam)
3. The flagged content enters **dispute resolution**
4. If the claim is upheld → reporter earns the bounty (from creator's slashed stake)
5. If the claim is rejected → reporter's counter-stake is slashed (anti-spam)

### 3.2 Bounty Economics

| Party              | If claim upheld                                 | If claim rejected                                                      |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Reporter           | Earns 60% of creator's slashed stake            | Loses counter-stake                                                    |
| Creator (thief)    | Stake slashed, earnings frozen, content removed | No penalty, counter-stake → creator                                    |
| Legitimate creator | N/A                                             | Receives reporter's counter-stake as compensation for false accusation |

### 3.3 Curation Reputation

Reporters build a **curation reputation score**:

- Successful reports → reputation increases → lower counter-stake required
- False reports → reputation decreases → higher counter-stake required
- High-reputation curators get **early access** to new uploads for review (before challenge period ends)

This naturally creates a **class of professional curators** who are economically incentivized to police the platform — without being centralized employees.

### 3.4 Anti-Abuse Safeguards

The curation system itself can be abused. Protections:

| Attack Vector                                                      | Safeguard                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Frivolous flagging** (spam reports to harass creators)           | Counter-stake requirement; slashed if rejected                       |
| **Coordinated flagging** (mob attacks on a creator)                | Multiple flags on the same content consolidated into one dispute     |
| **Self-flagging** (flag your own content to trigger escrow refund) | Reporter cannot be the same wallet as the creator                    |
| **Sybil flagging** (create many accounts to flag)                  | Counter-stake per flag; proof-of-humanity for high-volume reporters  |
| **Collusion** (creator and reporter split the bounty)              | Bounty only paid if content is actually taken down (loss to creator) |

---

## 4. On-Chain Provenance (Cryptographic Proof of Authorship)

### 4.1 Upload Attestation

At upload time, the creator signs an on-chain attestation **per release**. The attestation covers the full track(s) and, by inheritance, all derived stems.

```solidity
struct ContentAttestation {
    address creator;         // Wallet that signs
    bytes32 contentHash;     // SHA-256 of the original full-track audio file
    bytes32 fingerprintHash; // Hash of the Chromaprint fingerprint (full track)
    uint256 timestamp;       // Block timestamp
    uint256 releaseId;       // On-chain release identifier
    string metadataURI;      // IPFS CID pointing to release metadata
    bool isOriginalWork;     // Explicit declaration of originality
    string[] sourceCredits;  // Credits for samples/remixes used (if any)
}
```

> [!NOTE]
> The attestation is per-release, not per-stem. When Demucs generates 6 stems from a track, all 6 automatically inherit the attestation of their parent track. The `releaseId` links the attestation to all tracks and stems in the release.

This attestation is stored on-chain and is **irrefutable evidence** of:

- **Who** uploaded the content (wallet address)
- **When** it was uploaded (block timestamp — immutable)
- **What** was uploaded (content hash — tamper-proof)
- **Declaration** that it's original work (legal liability is on the signer)

### 4.2 Priority Proof

When two parties dispute ownership, the on-chain attestation provides **cryptographic priority proof**:

- Earlier block timestamp wins (all else being equal)
- Combined with external evidence (prior publication on other platforms), this creates an extremely strong IP record

### 4.3 Cross-Platform Verification

The attestation is publicly queryable:

```
ContentProtection.getAttestation(tokenId) → ContentAttestation
ContentProtection.isBlacklisted(address) → bool
ContentProtection.getDisputeHistory(tokenId) → Dispute[]
```

External platforms, lawyers, and rights organizations can verify any content's provenance without relying on Resonate's backend.

---

## 5. Dispute Resolution

### 5.1 Resolution Tiers

Not all disputes need the same process:

| Dispute Type                                       | Resolution Method            | Timeline   |
| -------------------------------------------------- | ---------------------------- | ---------- |
| **Exact match** (fingerprint > 95% confidence)     | Automatic takedown           | Immediate  |
| **High similarity** (fingerprint 80-95%)           | Platform review (fast-track) | 48 hours   |
| **Community flag** (human report with evidence)    | Evidence-based review        | 7 days     |
| **Complex dispute** (both parties claim ownership) | Decentralized arbitration    | 14-30 days |

### 5.2 Evidence Framework

Disputes are resolved based on a weighted evidence hierarchy:

| Evidence Type                  | Weight     | Example                                           |
| ------------------------------ | ---------- | ------------------------------------------------- |
| On-chain attestation timestamp | ⭐⭐⭐⭐⭐ | StemNFT minted at block #X                        |
| Audio fingerprint match        | ⭐⭐⭐⭐   | Chromaprint 97% match                             |
| External publication proof     | ⭐⭐⭐     | Spotify release dated before Resonate upload      |
| Social proof                   | ⭐⭐       | Artist's verified social account claims ownership |
| Metadata match                 | ⭐         | Same ISRC code, same credits                      |

### 5.3 Decentralized Arbitration (Phase 2+)

For complex disputes that cannot be resolved automatically:

**Option A: Kleros Integration**

- [Kleros](https://kleros.io/) is a decentralized arbitration protocol
- Jurors are randomly selected and economically incentivized to judge honestly
- Evidence is submitted on-chain, ruling is binding
- Cost: ~$50-200 per dispute (paid from the slashed stake)

**Option B: Resonate DAO Jury**

- A subset of high-reputation curators vote on disputes
- Requires staking to participate as a juror (skin in the game)
- Simpler to implement, but less decentralized than Kleros

**Recommended:** Start with platform-moderated review (Phase 1), migrate to Kleros or DAO jury as the platform scales.

### 5.4 Appeal Process

After a dispute ruling:

- The losing party has **14 days to appeal**
- Appeal requires a **higher stake** (2x the original)
- Appeal goes to a **different set of jurors** (if using decentralized arbitration)
- Maximum 2 appeals per dispute (to prevent indefinite delays)

---

## 6. Reputation & Trust System

### 6.1 Creator Trust Score

Every creator has a trust score that determines their privileges:

```
Trust Score = f(uploads, clean_history, disputes_lost, account_age, proof_of_humanity)
```

| Trust Level     | Score  | Privileges                                                |
| --------------- | ------ | --------------------------------------------------------- |
| **Unverified**  | 0-10   | Max stake, 30-day escrow, all uploads fingerprint-checked |
| **New**         | 11-30  | Standard stake, 14-day escrow                             |
| **Established** | 31-60  | Reduced stake, 7-day escrow                               |
| **Trusted**     | 61-90  | Minimal stake, 3-day escrow, priority processing          |
| **Verified**    | 91-100 | No stake, minimal escrow, auto-approved uploads           |

### 6.2 Trust Boosters

| Action                                                   | Trust Impact |
| -------------------------------------------------------- | ------------ |
| Complete proof-of-humanity (Gitcoin Passport, Worldcoin) | +20          |
| Link verified social accounts (Twitter, Instagram)       | +5 each      |
| 10 uploads with no disputes                              | +10          |
| 1 year on the platform with clean history                | +15          |
| Successfully defend against a false dispute              | +5           |

### 6.3 Trust Penalties

| Action                                                | Trust Impact           |
| ----------------------------------------------------- | ---------------------- |
| Dispute upheld (content confirmed stolen)             | -50 (devastating)      |
| Multiple disputes filed against you (even if pending) | -5 per pending dispute |
| Account flagged by high-reputation curators           | -10                    |

### 6.4 Sybil Resistance

To prevent bad actors from creating fresh wallets after being blacklisted:

- **Proof-of-humanity** required for trust levels above "New"
- **Progressive trust building** — no shortcuts; trust must be earned over time
- **Cross-wallet blacklisting** — if a blacklisted wallet is linked (via on-chain analysis) to a new wallet, the new wallet inherits the ban

---

## 7. Legal Layer (DMCA Safe Harbor)

### 7.1 Why This Matters

Even with all the crypto-economic protections, Resonate needs **legal safe harbor** to operate. Under the DMCA (US) and EU Copyright Directive, platforms are protected from liability if they:

1. Have a designated DMCA agent
2. Respond to legitimate takedown requests promptly
3. Don't have actual knowledge of infringement (they aren't pre-screening everything manually)

### 7.2 Required Infrastructure

| Component                   | Implementation                                                          |
| --------------------------- | ----------------------------------------------------------------------- |
| **DMCA takedown endpoint**  | `POST /api/dmca/report` — accepts standardized takedown requests        |
| **Counter-notification**    | `POST /api/dmca/counter` — creator can dispute a DMCA takedown          |
| **Designated agent**        | Legal point of contact registered with the US Copyright Office          |
| **Response SLA**            | Takedown within 24-48 hours of valid request                            |
| **Repeat infringer policy** | The progressive penalty system (Section 2.3) satisfies this requirement |

### 7.3 On-Chain DMCA Record

DMCA takedowns are recorded on-chain for transparency:

- `DMCANotice(tokenId, claimant, reason, timestamp)`
- `DMCACounterNotice(tokenId, creator, response, timestamp)`
- `DMCAResolution(tokenId, outcome, timestamp)`

This prevents abuse of the DMCA process (e.g., false takedowns to suppress competition) because all actions are publicly auditable.

---

## 8. Edge Cases

### 8.1 Cover Songs

**Problem:** An artist records their own performance of a copyrighted composition (e.g., a jazz standard). The audio is original, but the composition belongs to someone else.

**Resolution:**

- Fingerprinting won't catch this (the recording is original)
- Require the uploader to declare whether the work includes third-party compositions
- If declared: apply mechanical license rules (Harry Fox Agency / Songtrust integration — future)
- If not declared and caught: treated as a dispute, with lower penalties (honest mistake vs. theft)

### 8.2 Sampled Content

**Problem:** A producer uses a 2-second snippet from another track in their beat.

**Resolution:**

- The `sourceCredits[]` field in the attestation must declare samples used
- If the sample source is a Resonate stem → ancestry tracking handles royalties automatically
- If the source is external → creator must declare it and hold appropriate rights
- Fingerprinting may or may not catch short samples (depends on length and processing)

### 8.3 AI-Generated Content

**Problem:** An AI generates a vocal stem using a model trained on copyrighted recordings.

**Resolution:**

- AI-generated content is allowed but must be declared as such
- The generating account holds the license and bears responsibility
- If the AI output is detectably similar to training data (fingerprint match) → quarantined
- Same royalty and protection rules apply — no "AI loophole"

### 8.4 Public Domain Works

**Problem:** Someone uploads a recording of a Beethoven symphony. The composition is public domain, but the recording might belong to an orchestra.

**Resolution:**

- Composition public domain ≠ recording public domain
- Fingerprinting catches known commercial recordings of public domain works
- If the uploader claims to have recorded it themselves → attestation + challenge period

### 8.5 Regional Copyright Differences

**Problem:** A work is public domain in one country but copyrighted in another.

**Resolution:**

- Resonate licenses default to "worldwide" territory
- Territory-specific licensing (from the Licensing Architecture RFC) can restrict availability
- For MVP: assume worldwide copyright as the conservative default

### 8.6 Collaborative Works with Disputes

**Problem:** Two collaborators created a stem together, but one uploads it and cuts the other out.

**Resolution:**

- On-chain split configuration (0xSplits) is the canonical source of truth
- If a co-creator disputes, the dispute resolution process reviews evidence of collaboration
- The `ContentAttestation.sourceCredits[]` should include all collaborators
- Missing credits = grounds for dispute

### 8.7 Re-mastered / Slightly Modified Copies

**Problem:** Someone takes a track, applies a slight EQ change or pitch shift, and re-uploads.

**Resolution:**

- Chromaprint is designed to be resilient to minor audio modifications
- Catches: pitch shifts up to ±4 semitones, EQ changes, compression, format conversion
- Catches: speed changes up to ±10%
- May not catch: extreme time-stretching, reversed audio, heavy vocoder processing
- Community curation layer catches what fingerprinting misses

---

## 9. Smart Contract Architecture

### 9.1 New Contracts Required

| Contract            | Purpose               | Key Functions                                                    |
| ------------------- | --------------------- | ---------------------------------------------------------------- |
| `ContentProtection` | Core protection logic | `attestRelease()`, `stakeForRelease()`, `slash()`, `blacklist()` |
| `DisputeResolution` | Dispute lifecycle     | `fileDispute()`, `submitEvidence()`, `resolve()`, `appeal()`     |
| `RevenueEscrow`     | Delayed earnings      | `deposit()`, `freeze()`, `release()`, `redirect()`               |
| `CurationRewards`   | Reporter bounties     | `reportContent()`, `claimBounty()`, `updateReputation()`         |

### 9.2 Integration with Existing Contracts

| Existing Contract     | Integration Point                                                                     |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Release** (backend) | Upload creates a Release → triggers `ContentProtection.attestRelease()`               |
| `StemNFT`             | `mintAuthorized()` requires a signed release `protectionId` that is verified on-chain |
| `StemMarketplaceV2`   | Sales revenue (stem licensing) routed through `RevenueEscrow` during challenge period |
| `TransferValidator`   | Checks `ContentProtection.isBlacklisted()` before allowing transfers                  |

**Protection inheritance model in contracts:**

```solidity
// ContentProtection.sol
function attestRelease(uint256 releaseId, bytes32 contentHash, bytes32 fingerprintHash, string memory metadataURI) external;
function stakeForRelease(uint256 releaseId) external payable;
function isReleaseVerified(uint256 releaseId) external view returns (bool);
function isTrackVerified(uint256 trackId) external view returns (bool); // delegates to parent release
function isStemVerified(uint256 stemTokenId) external view returns (bool); // delegates to parent track → release

// When a dispute is upheld on a release:
function revokeRelease(uint256 releaseId) external; // cascades: delist all tracks + all derived stems
```

### 9.3 Revenue Escrow Scope

The `RevenueEscrow` contract handles earnings from **all revenue layers** (per the [Business Model](./business-model.md)):

| Revenue Layer               | Source                      | Escrow?                             |
| --------------------------- | --------------------------- | ----------------------------------- |
| Layer 1 (Free streaming)    | No artist revenue           | N/A                                 |
| Layer 2 (Pro micropayments) | Per-play from agent wallets | ✅ Escrowed during challenge period |
| Layer 3 (Stem licensing)    | License purchases           | ✅ Escrowed during challenge period |
| Remix royalties             | Ancestry-based splits       | ✅ Escrowed during challenge period |

### 9.4 Upgrade Path

All contracts should use the **UUPS proxy pattern** (already used for `StemMarketplaceV2`) to allow parameter tuning (stake amounts, escrow periods, slash percentages) without redeployment.

---

## 10. Implementation Phases

### Phase 1: Foundation (P0 — Current Priority)

| Task                                                | Component                 | Effort      |
| --------------------------------------------------- | ------------------------- | ----------- |
| Wallet-signed upload attestation                    | Smart Contract + Frontend | 1 sprint    |
| Chromaprint integration in Demucs worker            | Backend (AI worker)       | 1-2 sprints |
| Internal fingerprint database + duplicate detection | Backend                   | 1 sprint    |
| Content quarantine queue (admin review)             | Backend + Frontend        | 1 sprint    |
| DMCA takedown endpoint                              | Backend                   | 0.5 sprint  |

**Deliverable:** Every upload is fingerprinted, attested, and compared against known content. Matches are quarantined. DMCA compliance established.

---

### Phase 2: Economic Deterrents (P1)

| Task                                                 | Component      | Effort      |
| ---------------------------------------------------- | -------------- | ----------- |
| `ContentProtection` contract (attestation + staking) | Smart Contract | 2 sprints   |
| `RevenueEscrow` contract (delayed earnings)          | Smart Contract | 1-2 sprints |
| Stake deposit UX in upload flow                      | Frontend       | 1 sprint    |
| Escrow dashboard for creators (earnings timeline)    | Frontend       | 1 sprint    |
| Progressive trust tier system (backend)              | Backend        | 1 sprint    |

**Deliverable:** Creators must stake to publish. Earnings are escrowed. Trust tiers reduce friction for proven creators.

---

### Phase 3: Community Curation (P1-P2)

| Task                                                | Component                 | Effort      |
| --------------------------------------------------- | ------------------------- | ----------- |
| `CurationRewards` contract (bounties)               | Smart Contract            | 1-2 sprints |
| `DisputeResolution` contract (disputes + evidence)  | Smart Contract            | 2 sprints   |
| Flag content UI (report button + evidence form)     | Frontend                  | 1 sprint    |
| Dispute dashboard (dispute status, evidence viewer) | Frontend                  | 1 sprint    |
| Curation reputation scoring                         | Backend                   | 1 sprint    |
| Appeal process                                      | Smart Contract + Frontend | 1 sprint    |

**Deliverable:** Community-powered content policing with economic incentives. Disputes are resolved with evidence-based process.

---

### Phase 4: Advanced Detection (P2)

| Task                                                     | Component | Effort      |
| -------------------------------------------------------- | --------- | ----------- |
| External fingerprint DB integration (Audd.io / AcoustID) | Backend   | 1 sprint    |
| AI similarity model training                             | AI worker | 2-3 sprints |
| Metadata cross-referencing (ISRC/ISWC/MusicBrainz)       | Backend   | 1 sprint    |
| Cross-platform monitoring                                | Backend   | 2 sprints   |

**Deliverable:** Near-comprehensive automated detection covering both known commercial catalog and internal corpus.

---

### Phase 5: Decentralized Governance (P3)

| Task                                                         | Component          | Effort      |
| ------------------------------------------------------------ | ------------------ | ----------- |
| Kleros or DAO jury integration                               | Smart Contract     | 2-3 sprints |
| On-chain DMCA records                                        | Smart Contract     | 1 sprint    |
| Cross-wallet blacklisting (on-chain analytics)               | Backend + Contract | 1-2 sprints |
| Public API for external platforms to query protection status | Backend            | 1 sprint    |

**Deliverable:** Fully decentralized dispute resolution. Public, auditable protection records. Interoperable with external platforms.

---

## 11. Relationship to Existing RFCs

| RFC                                                   | Relationship                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Business Model](./business-model.md)                 | Defines the 3-layer revenue model (Free → Pro → Licensing). Content protection anchors at the full track (Layer 1 entry point) and escrows all revenue across Layers 2-3 |
| [Licensing Architecture](./licensing-architecture.md) | Content protection is a prerequisite — you can't license content if you can't verify ownership                                                                           |
| [Licensing Roadmap](./licensing-roadmap.md)           | Phase 5 (Cross-Platform Enforcement) is absorbed into this RFC's Phase 4                                                                                                 |
| [RESONATE_SPECS.md](./RESONATE_SPECS.md)              | Content protection should be added as a core platform pillar                                                                                                             |

---

## 12. Security Considerations

1. **Fingerprint poisoning** — An attacker uploads many slightly modified versions to pollute the fingerprint DB. Mitigation: rate limiting + stake requirement makes this expensive.
2. **Oracle manipulation** — If external fingerprint databases return wrong results. Mitigation: use multiple sources, require human confirmation for quarantine → takedown.
3. **Stake front-running** — Attacker sees a dispute tx in the mempool and withdraws stake before it executes. Mitigation: stake is locked in the contract, cannot be withdrawn during challenge period.
4. **Gas griefing** — Filing disputes that cost gas to process. Mitigation: reporter counter-stake covers gas costs; rejected disputes forfeit the counter-stake.
5. **Escrow reentrancy** — `RevenueEscrow.release()` makes external calls. Mitigation: ReentrancyGuard + CEI pattern (consistent with existing contract security posture).

---

## References

- [Chromaprint (AcoustID)](https://acoustid.org/chromaprint)
- [Dejavu Audio Fingerprinting](https://github.com/worldveil/dejavu)
- [Kleros Decentralized Arbitration](https://kleros.io/)
- [Gitcoin Passport](https://passport.gitcoin.co/)
- [DMCA Safe Harbor (17 U.S.C. § 512)](https://www.law.cornell.edu/uscode/text/17/512)
- [EU Copyright Directive — Article 17](https://eur-lex.europa.eu/eli/dir/2019/790/oj)
- [EIP-2981: NFT Royalty Standard](https://eips.ethereum.org/EIPS/eip-2981)
- [UUPS Proxy Pattern (EIP-1822)](https://eips.ethereum.org/EIPS/eip-1822)
