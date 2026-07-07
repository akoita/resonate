/**
 * #1408 — migration verification gate (pure compare logic, no DB).
 *
 * compareSnapshots is the cutover decision: empty failures = SAFE, any failure
 * = BLOCK. These cases pin the guarantees the gate must enforce.
 */

import { describe, expect, it } from "@jest/globals";
import { compareSnapshots } from "../scripts/verify_migration";

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
});
