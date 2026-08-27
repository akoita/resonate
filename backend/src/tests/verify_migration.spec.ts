/**
 * #1408 — migration verification gate (pure compare logic, no DB).
 *
 * compareSnapshots is the cutover decision: empty failures = SAFE, any failure
 * = BLOCK. These cases pin the guarantees the gate must enforce.
 */

import { describe, expect, it } from "@jest/globals";
import {
  compareSnapshots,
  parseForbiddenReferences,
  validateStrictSnapshotInputs,
  type Snapshot,
} from "../scripts/verify_migration";

const base = {
  rowCounts: { User: 3, Wallet: 3, Track: 10, Release: 4, ShowCampaign: 2, AnalyticsEvent: 100 },
  identity: {
    publicKeyHash: "a".repeat(64),
    userId: "user-1",
    walletAddress: "0xabc",
    chainId: 84532,
    accountType: "erc4337",
    firstWalletAddress: "0xabc",
    lastWalletAddress: "0xabc",
    found: true,
  },
  cursors: {
    indexerState: [{ chainId: 84532, lastBlockNumber: "1000" }],
    showEscrowIndexerState: [{ chainId: 84532, lastBlockNumber: "900" }],
  },
  sampleContent: { users: true, tracks: true, releases: true, shows: true },
};
const clone = () => JSON.parse(JSON.stringify(base));

const strictEvidence = {
  mode: "strict-cutover" as const,
  analyticsRequired: false,
  identity: { found: true },
  samples: {
    track: { found: true },
    release: { found: true },
    showCampaign: { found: true },
  },
  forbiddenReferences: [
    { label: "source-project", valueSha256: "a".repeat(64), totalMatches: 0, locations: [] },
    { label: "source-bucket", valueSha256: "b".repeat(64), totalMatches: 0, locations: [] },
  ],
};

const strictClone = (): Snapshot => ({ ...clone(), strictCutover: JSON.parse(JSON.stringify(strictEvidence)) });

describe("compareSnapshots", () => {
  it("passes when target mirrors source exactly", () => {
    const { failures, warnings } = compareSnapshots(clone(), clone());
    expect(failures).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("BLOCKS on row loss (data loss = cutover fail)", () => {
    const target = clone();
    target.rowCounts.Track = 7;
    const { failures } = compareSnapshots(clone(), target);
    expect(failures.some((f) => f.includes('"Track" lost rows'))).toBe(true);
  });

  it("BLOCKS on a missing table", () => {
    const target = clone();
    delete target.rowCounts.ShowCampaign;
    const { failures } = compareSnapshots(clone(), target);
    expect(failures.some((f) => f.includes('"ShowCampaign" is missing'))).toBe(true);
  });

  it("WARNS (not blocks) when target grew", () => {
    const target = clone();
    target.rowCounts.User = 5;
    const { failures, warnings } = compareSnapshots(clone(), target);
    expect(failures).toEqual([]);
    expect(warnings.some((w) => w.includes('"User" grew'))).toBe(true);
  });

  it("BLOCKS when the sample identity is not found on target", () => {
    const target = clone();
    target.identity = { ...target.identity, found: false, userId: null, walletAddress: null };
    const { failures } = compareSnapshots(clone(), target);
    expect(failures.some((f) => f.includes("sample user not found on target"))).toBe(true);
  });

  it("BLOCKS when the sample identity resolves to a DIFFERENT account", () => {
    const target = clone();
    target.identity = { ...target.identity, walletAddress: "0xdifferent" };
    const { failures } = compareSnapshots(clone(), target);
    expect(failures.some((f) => f.includes("identity: mismatch"))).toBe(true);
  });

  it("BLOCKS when an indexer cursor is missing (would rescan from 0)", () => {
    const target = clone();
    target.cursors.indexerState = [];
    const { failures } = compareSnapshots(clone(), target);
    expect(failures.some((f) => f.includes("indexerState cursor for chain 84532 missing"))).toBe(true);
  });

  it("BLOCKS when an indexer cursor regressed", () => {
    const target = clone();
    target.cursors.showEscrowIndexerState = [{ chainId: 84532, lastBlockNumber: "500" }];
    const { failures } = compareSnapshots(clone(), target);
    expect(failures.some((f) => f.includes("showEscrowIndexerState cursor for chain 84532 regressed"))).toBe(true);
  });

  it("matches Shows escrow cursors by chain and contract address", () => {
    const source = clone();
    source.cursors.showEscrowIndexerState = [{
      chainId: 84532,
      contractAddress: "0x1111111111111111111111111111111111111111",
      lastBlockNumber: "900",
    }];
    const target = clone();
    target.cursors.showEscrowIndexerState = [{
      chainId: 84532,
      contractAddress: "0x2222222222222222222222222222222222222222",
      lastBlockNumber: "1000",
    }];
    const { failures } = compareSnapshots(source, target);
    expect(failures.some((f) => f.includes("contract 0x1111111111111111111111111111111111111111 missing"))).toBe(true);
  });

  it("rejects an old address-less Shows cursor snapshot when target has multiple contracts", () => {
    const target = clone();
    target.cursors.showEscrowIndexerState = [
      { chainId: 84532, contractAddress: "0x1111111111111111111111111111111111111111", lastBlockNumber: "900" },
      { chainId: 84532, contractAddress: "0x2222222222222222222222222222222222222222", lastBlockNumber: "900" },
    ];
    const { failures } = compareSnapshots(clone(), target);
    expect(failures.some((f) => f.includes("ambiguous on target"))).toBe(true);
  });

  it("BLOCKS when source had content but target has none", () => {
    const target = clone();
    target.sampleContent.tracks = false;
    target.rowCounts.Track = 0;
    const { failures } = compareSnapshots(clone(), target);
    expect(failures.some((f) => f.includes("source had tracks but target has none"))).toBe(true);
  });

  it("WARNS when no identity selector was captured", () => {
    const source = clone();
    source.identity = null;
    const target = clone();
    target.identity = null;
    const { failures, warnings } = compareSnapshots(source, target);
    expect(failures).toEqual([]);
    expect(warnings.some((w) => w.includes("identity continuity not asserted"))).toBe(true);
  });

  it("passes strict cutover when all required evidence is present", () => {
    const { failures, warnings } = compareSnapshots(strictClone(), strictClone(), { strictCutover: true });
    expect(failures).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("BLOCKS strict cutover for legacy snapshots without strict evidence", () => {
    const { failures } = compareSnapshots(clone(), clone(), { strictCutover: true });
    expect(failures).toEqual([
      "strict-cutover: source snapshot is legacy/non-strict",
      "strict-cutover: target snapshot is legacy/non-strict",
    ]);
  });

  it("BLOCKS strict cutover when identity or exact samples are missing", () => {
    const source = strictClone();
    source.strictCutover!.identity = { found: false };
    source.strictCutover!.samples.track = { found: false };
    delete (source.strictCutover!.samples as { release?: { found: boolean } }).release;
    const target = strictClone();
    target.strictCutover!.samples.showCampaign = { found: false };

    const { failures } = compareSnapshots(source, target, { strictCutover: true });
    expect(failures).toEqual(
      expect.arrayContaining([
        "strict-cutover: source snapshot is missing a found identity sample",
        "strict-cutover: source snapshot is missing a found track sample",
        "strict-cutover: source snapshot is missing a found release sample",
        "strict-cutover: target snapshot is missing a found showCampaign sample",
      ]),
    );
  });

  it("BLOCKS strict cutover when the target retains a forbidden source reference", () => {
    const target = strictClone();
    target.strictCutover!.forbiddenReferences[1] = {
      label: "source-bucket",
      valueSha256: "b".repeat(64),
      totalMatches: 2,
      locations: [{ table: "Track", column: "audioUrl", count: 2 }],
    };

    const { failures } = compareSnapshots(strictClone(), target, { strictCutover: true });
    expect(failures).toContain(
      "strict-cutover: target contains forbidden reference source-bucket in 2 row(s) across 1 column location(s)",
    );
    expect(failures.join(" ")).not.toContain("bucket-value");
  });

  it("BLOCKS strict cutover for a target-only stale forbidden-reference label", () => {
    const target = strictClone();
    target.strictCutover!.forbiddenReferences.push({
      label: "source-uri",
      valueSha256: "c".repeat(64),
      totalMatches: 1,
      locations: [{ table: "Release", column: "artworkUrl", count: 1 }],
    });

    const { failures } = compareSnapshots(strictClone(), target, { strictCutover: true });
    expect(failures.some((failure) => failure.includes("source-uri"))).toBe(true);
  });

  it("requires analytics evidence only in analytics-required mode", () => {
    const optional = strictClone();
    expect(compareSnapshots(optional, optional, { strictCutover: true }).failures).toEqual([]);

    const required = strictClone();
    required.strictCutover!.analyticsRequired = true;
    required.strictCutover!.samples.analytics = { found: true };
    expect(compareSnapshots(required, required, { strictCutover: true, analyticsRequired: true }).failures).toEqual([]);

    delete required.strictCutover!.samples.analytics;
    const { failures } = compareSnapshots(required, required, { strictCutover: true, analyticsRequired: true });
    expect(failures.some((failure) => failure.includes("missing a found analytics sample"))).toBe(true);
  });

  it("BLOCKS strict cutover when the same forbidden-reference label has different value digests", () => {
    const target = strictClone();
    target.strictCutover!.forbiddenReferences[0].valueSha256 = "f".repeat(64);

    const { failures } = compareSnapshots(strictClone(), target, { strictCutover: true });
    expect(failures).toContain(
      "strict-cutover: forbidden reference source-project value digest differs between source and target",
    );
  });

  it("BLOCKS strict cutover for inconsistent forbidden-reference totals", () => {
    const source = strictClone();
    source.strictCutover!.forbiddenReferences[0].totalMatches = 1;

    const { failures } = compareSnapshots(source, strictClone(), { strictCutover: true });
    expect(failures).toContain("strict-cutover: source snapshot has inconsistent forbidden-reference totals");
  });
});

describe("strict-cutover input parsing", () => {
  it("rejects malformed and duplicate forbidden references", () => {
    expect(() => parseForbiddenReferences(["source-project"])).toThrow("malformed forbidden reference");
    expect(() => parseForbiddenReferences(["source project=value"])).toThrow("malformed forbidden reference");
    expect(() => parseForbiddenReferences(["source-project=value", "SOURCE-PROJECT=other"])).toThrow(
      "duplicate forbidden reference label",
    );
  });

  it("requires identity, reviewed samples, and source-reference labels", () => {
    expect(() => validateStrictSnapshotInputs({}, {}, false, [])).toThrow("requires an identity selector");

    expect(() =>
      validateStrictSnapshotInputs(
        { wallet: "0xabc" },
        { track: "track-1" },
        false,
        parseForbiddenReferences(["source-project=project", "source-bucket=bucket"]),
      ),
    ).toThrow("requires reviewed sample selectors");

    expect(() =>
      validateStrictSnapshotInputs(
        { wallet: "0xabc" },
        { track: "track-1", release: "release-1", showCampaign: "show-1" },
        true,
        parseForbiddenReferences(["source-project=project", "source-bucket=bucket"]),
      ),
    ).toThrow("requires a reviewed analytics sample selector");

    expect(() =>
      validateStrictSnapshotInputs(
        { wallet: "0xabc" },
        { track: "track-1", release: "release-1", showCampaign: "show-1" },
        false,
        parseForbiddenReferences(["source-project=project"]),
      ),
    ).toThrow("source-bucket");
  });
});
