/**
 * End-to-end shape of a personal-data export (#1771 slice 2), against a real
 * Postgres. Two people are seeded with the same kinds of record; the test that
 * matters most is that neither appears in the other's file.
 */
import { PassThrough } from "stream";
import { prisma } from "../db/prisma";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { PersonalDataExportService } from "../modules/privacy/personal_data_export.service";

const TEST_PREFIX = `personal_data_export_${Date.now()}_`;

const USER_A = `${TEST_PREFIX}user_a`;
const USER_B = `${TEST_PREFIX}user_b`;

// Checksummed on the wallet, so the resolver lowercases it and every
// wallet-keyed lookup has to cope with the difference.
const A_WALLET_CHECKSUMMED = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa1771";
const A_WALLET_LOWERCASE = A_WALLET_CHECKSUMMED.toLowerCase();
const B_WALLET_CHECKSUMMED = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb1771";

const A_AGENT_PRIVATE_KEY = `0x${"a7".repeat(32)}`;
const B_AGENT_PRIVATE_KEY = `0x${"b7".repeat(32)}`;

// Two full batches plus a remainder: enough to cross the 500-row page size
// more than once and to end on a short final page.
const BULK_NOTIFICATIONS = 1103;

const A_TOKEN_ID = 90071992547409931n; // Beyond Number.MAX_SAFE_INTEGER on purpose.
const B_TOKEN_ID = 90071992547409932n;

const service = new PersonalDataExportService(new PersonalDataResolverService());

interface Seed {
  userId: string;
  wallet: string;
  privateKey: string;
  tokenId: bigint;
  suffix: string;
}

const SEED_A: Seed = {
  userId: USER_A,
  wallet: A_WALLET_CHECKSUMMED,
  privateKey: A_AGENT_PRIVATE_KEY,
  tokenId: A_TOKEN_ID,
  suffix: "a",
};
const SEED_B: Seed = {
  userId: USER_B,
  wallet: B_WALLET_CHECKSUMMED,
  privateKey: B_AGENT_PRIVATE_KEY,
  tokenId: B_TOKEN_ID,
  suffix: "b",
};

async function seed(person: Seed) {
  const id = (name: string) => `${TEST_PREFIX}${name}_${person.suffix}`;

  await prisma.user.create({
    data: { id: person.userId, email: `${person.userId}@test.resonate` },
  });
  await prisma.wallet.create({
    data: {
      id: id("wallet"),
      userId: person.userId,
      address: person.wallet,
      chainId: 11155111,
      salt: `${TEST_PREFIX}derivation_salt_${person.suffix}`,
    },
  });

  // A plain userId-keyed model.
  await prisma.playlist.create({
    data: { id: id("playlist"), userId: person.userId, name: `${TEST_PREFIX}playlist_${person.suffix}` },
  });

  // One of the nine models that does not spell the key `userId`.
  await prisma.communityRoom.create({
    data: {
      id: id("room"),
      roomType: `${TEST_PREFIX}room_${person.suffix}`,
      ownerType: "user",
      ownerId: person.userId,
      title: `${TEST_PREFIX}room_${person.suffix}`,
    },
  });
  await prisma.communityMessage.create({
    data: {
      id: id("message"),
      roomId: id("room"),
      authorId: person.userId,
      body: `${TEST_PREFIX}message_${person.suffix}`,
    },
  });

  // Wallet-keyed, stored in the checksummed case the notification service
  // passes straight through from on-chain values.
  await prisma.notification.create({
    data: {
      id: id("notification"),
      walletAddress: person.wallet,
      type: "dispute_filed",
      title: `${TEST_PREFIX}notification_${person.suffix}`,
      message: `${TEST_PREFIX}notification_text_${person.suffix}`,
    },
  });

  // More rows than one batch holds, so the cursor pagination that keeps peak
  // memory flat is actually exercised rather than assumed.
  await prisma.notification.createMany({
    data: Array.from({ length: BULK_NOTIFICATIONS }, (_unused, index) => ({
      id: `${TEST_PREFIX}bulk_${person.suffix}_${String(index).padStart(4, "0")}`,
      walletAddress: index % 2 === 0 ? person.wallet : person.wallet.toLowerCase(),
      type: "listing_expiring_soon",
      title: `${TEST_PREFIX}bulk_${person.suffix}_${index}`,
      message: `${TEST_PREFIX}bulk_text_${person.suffix}_${index}`,
    })),
  });

  // An on-chain mirror carrying BigInt columns, keyed by a lowercase address.
  await prisma.royaltyPayment.create({
    data: {
      id: id("royalty"),
      tokenId: person.tokenId,
      chainId: 11155111,
      recipientAddress: person.wallet.toLowerCase(),
      amount: "1000000000000000",
      transactionHash: `0x${TEST_PREFIX.replace(/[^0-9a-f]/gi, "")}${person.suffix}`.slice(0, 66),
      blockNumber: 9007199254740993n,
      paidAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  });

  // Analytics, keyed by the derived pseudonymous actor id.
  await prisma.analyticsEvent.create({
    data: {
      id: id("analytics"),
      eventId: id("analytics_event"),
      eventName: "playback.completed",
      eventVersion: 1,
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      receivedAt: new Date("2026-09-01T00:00:01.000Z"),
      producer: "backend",
      environment: "test",
      privacyTier: "pseudonymous",
      actorId: pseudonymousAnalyticsActorId(person.userId),
      payload: { marker: `${TEST_PREFIX}payload_${person.suffix}` },
      envelope: { marker: `${TEST_PREFIX}envelope_${person.suffix}` },
    },
  });

  // Analytics keyed by the RAW user id, not the pseudonymous hash.
  // `analytics_domain_event_bridge.service.ts` declares `actorIdKeys: ["userId"]`
  // for ~20 event types and nothing on the ingest path pseudonymizes it, so a
  // person's server-emitted analytics are keyed by their `User.id` — which for
  // a wallet account is their wallet address. An export matching only the
  // derived actor id missed all of it and still reported success.
  await prisma.analyticsEvent.create({
    data: {
      id: id("analytics_raw"),
      eventId: id("analytics_raw_event"),
      eventName: "generation.created",
      eventVersion: 1,
      occurredAt: new Date("2026-09-02T00:00:00.000Z"),
      receivedAt: new Date("2026-09-02T00:00:01.000Z"),
      producer: "backend",
      environment: "test",
      privacyTier: "pseudonymous",
      actorId: person.userId,
      subjectType: "user",
      subjectId: person.userId,
      payload: { marker: `${TEST_PREFIX}raw_payload_${person.suffix}` },
      envelope: { marker: `${TEST_PREFIX}raw_envelope_${person.suffix}` },
    },
  });

  // The record whose contents must never leave the backend.
  await prisma.sessionKey.create({
    data: {
      id: id("session_key"),
      userId: person.userId,
      agentPrivateKey: person.privateKey,
      agentAddress: `0xdead${person.suffix.repeat(2)}00000000000000000000000000000000`.slice(0, 42),
      approvalData: `${TEST_PREFIX}approval_${person.suffix}`,
      permissions: { target: "0x0", totalCap: 1 },
      validUntil: new Date("2027-01-01T00:00:00.000Z"),
    },
  });
}

async function cleanup() {
  const where = { id: { startsWith: TEST_PREFIX } };
  await prisma.sessionKey.deleteMany({ where });
  await prisma.analyticsEvent.deleteMany({ where });
  await prisma.royaltyPayment.deleteMany({ where });
  await prisma.notification.deleteMany({ where });
  await prisma.communityMessage.deleteMany({ where });
  await prisma.communityRoom.deleteMany({ where });
  await prisma.playlist.deleteMany({ where });
  await prisma.wallet.deleteMany({ where });
  await prisma.user.deleteMany({ where });
}

async function exportText(userId: string): Promise<string> {
  const prepared = await service.prepare(userId);
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<void>((resolve) => out.on("end", () => resolve()));
  await prepared.writeTo(out);
  out.end();
  await finished;
  return Buffer.concat(chunks).toString("utf8");
}

interface ExportDocument {
  format: string;
  formatVersion: number;
  exportedAt: string;
  subject: Record<string, unknown>;
  readMe: Record<string, string>;
  notIncluded: Array<{ what: string; why: string }>;
  data: Record<string, Array<Record<string, unknown>>>;
  counts: Record<string, number>;
  complete?: boolean;
}

describe("PersonalDataExportService integration", () => {
  let textA: string;
  let documentA: ExportDocument;

  beforeAll(async () => {
    await seed(SEED_A);
    await seed(SEED_B);
    textA = await exportText(USER_A);
    documentA = JSON.parse(textA) as ExportDocument;
  }, 60000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("produces a well-formed, complete document", () => {
    expect(documentA.format).toBe("resonate-personal-data-export");
    expect(documentA.formatVersion).toBe(1);
    expect(new Date(documentA.exportedAt).toISOString()).toBe(documentA.exportedAt);
    // Written last, on purpose: a response that failed mid-stream cannot
    // revise its status code, so absence is the truncation signal.
    expect(documentA.complete).toBe(true);
    expect(textA.trimEnd().endsWith('"complete":true}')).toBe(true);
  });

  it("names every identifier it searched by", () => {
    expect(documentA.subject).toMatchObject({
      userId: USER_A,
      email: `${USER_A}@test.resonate`,
      walletAddresses: [A_WALLET_LOWERCASE],
      ownerAddresses: [],
      artistIds: [],
      analyticsActorId: pseudonymousAnalyticsActorId(USER_A),
    });
  });

  it("explains itself and states its limits in plain language", () => {
    expect(Object.keys(documentA.readMe).length).toBeGreaterThan(0);
    const limits = documentA.notIncluded.map((entry) => `${entry.what} ${entry.why}`).join(" ").toLowerCase();
    expect(limits).toContain("ledger");
    expect(limits).toContain("ipfs");
    expect(limits).toContain("retention policy");
    for (const entry of documentA.notIncluded) {
      expect(entry.what.length).toBeGreaterThan(0);
      expect(entry.why.length).toBeGreaterThan(30);
    }
  });

  it("contains this person's rows from every kind of keying", () => {
    const ids = (model: string) => documentA.data[model].map((row) => row.id);

    // Plain userId column.
    expect(ids("Playlist")).toContain(`${TEST_PREFIX}playlist_a`);
    // A key that is not called userId.
    expect(ids("CommunityMessage")).toContain(`${TEST_PREFIX}message_a`);
    // Wallet address, stored checksummed while the resolver returns lowercase.
    expect(ids("Notification")).toContain(`${TEST_PREFIX}notification_a`);
    // On-chain mirror.
    expect(ids("RoyaltyPayment")).toContain(`${TEST_PREFIX}royalty_a`);
    // Pseudonymous analytics actor id.
    expect(ids("AnalyticsEvent")).toContain(`${TEST_PREFIX}analytics_a`);
    // The bridge-emitted row, keyed by the raw user id rather than the hash.
    // Without both forms in the manifest this passes for the pseudonymous row
    // and silently omits every server-emitted event the person generated.
    expect(ids("AnalyticsEvent")).toContain(`${TEST_PREFIX}analytics_raw_a`);
    // Security material: the record exists so it can be reviewed and revoked.
    expect(ids("SessionKey")).toContain(`${TEST_PREFIX}session_key_a`);
    // The account itself.
    expect(ids("User")).toEqual([USER_A]);
  });

  it("finds a wallet-keyed row stored in a different case than the resolver returns", () => {
    const notification = documentA.data.Notification.find(
      (row) => row.id === `${TEST_PREFIX}notification_a`,
    );
    expect(notification).toBeDefined();
    // The stored value is checksummed; the identifier searched for was
    // lowercase. A case-sensitive `in:` would have missed this row and the
    // export would have looked complete.
    expect(notification?.walletAddress).toBe(A_WALLET_CHECKSUMMED);
  });

  it("contains none of the other person's rows", () => {
    // The assertion this whole endpoint lives or dies by. Checked against the
    // raw text so a leak through any nesting — a JSON payload, an envelope, a
    // metadata blob — fails it.
    expect(textA).not.toContain(USER_B);
    expect(textA).not.toContain(B_WALLET_CHECKSUMMED);
    expect(textA).not.toContain(B_WALLET_CHECKSUMMED.toLowerCase());
    expect(textA).not.toContain(pseudonymousAnalyticsActorId(USER_B) as string);
    expect(textA).not.toContain(`${TEST_PREFIX}payload_b`);
    expect(textA).not.toContain(`${TEST_PREFIX}envelope_b`);

    for (const suffixed of [
      "playlist_b",
      "message_b",
      "room_b",
      "notification_b",
      "royalty_b",
      "analytics_b",
      "session_key_b",
      "wallet_b",
    ]) {
      expect(textA).not.toContain(`${TEST_PREFIX}${suffixed}`);
    }
  });

  it("never lets key material or derivation secrets into the file", () => {
    // Asserted against the serialized text, not a parsed field: a leak through
    // an unexpected nesting must fail this too.
    expect(textA).not.toContain(A_AGENT_PRIVATE_KEY);
    expect(textA).not.toContain(B_AGENT_PRIVATE_KEY);
    expect(textA).not.toContain(`${TEST_PREFIX}approval_a`);
    expect(textA).not.toContain(`${TEST_PREFIX}derivation_salt_a`);

    const sessionKey = documentA.data.SessionKey.find(
      (row) => row.id === `${TEST_PREFIX}session_key_a`,
    );
    // Existence and revocability survive redaction; the key does not.
    expect(sessionKey).toMatchObject({ userId: USER_A, revokedAt: null });
    expect(sessionKey).not.toHaveProperty("agentPrivateKey");
    expect(sessionKey).not.toHaveProperty("approvalData");
    expect(sessionKey?.validUntil).toBe("2027-01-01T00:00:00.000Z");
    expect(sessionKey?.permissions).toEqual({ target: "0x0", totalCap: 1 });

    const wallet = documentA.data.Wallet.find((row) => row.id === `${TEST_PREFIX}wallet_a`);
    expect(wallet).toBeDefined();
    expect(wallet).not.toHaveProperty("salt");
  });

  it("serializes Prisma's runtime types into something a reader can use", () => {
    const royalty = documentA.data.RoyaltyPayment.find(
      (row) => row.id === `${TEST_PREFIX}royalty_a`,
    );
    // A stray BigInt reaching JSON.stringify throws mid-stream, after the
    // status code has been sent.
    expect(royalty?.tokenId).toBe(A_TOKEN_ID.toString());
    expect(royalty?.blockNumber).toBe("9007199254740993");
    expect(royalty?.paidAt).toBe("2026-09-01T00:00:00.000Z");
    expect(typeof royalty?.createdAt).toBe("string");
  });

  it("agrees with itself: counts match the rows actually written", () => {
    expect(Object.keys(documentA.counts).sort()).toEqual(Object.keys(documentA.data).sort());
    for (const [model, rows] of Object.entries(documentA.data)) {
      expect(documentA.counts[model]).toBe(rows.length);
    }
    expect(documentA.counts.User).toBe(1);
    expect(documentA.counts.SessionKey).toBe(1);
  });

  it("pages past the batch size without dropping or repeating a row", () => {
    const ids = documentA.data.Notification.map((row) => row.id as string);
    // One seeded notification plus the bulk rows, read in pages of 500. A
    // cursor that skipped or re-read a page would change this number.
    expect(ids.length).toBe(BULK_NOTIFICATIONS + 1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(documentA.counts.Notification).toBe(ids.length);
    // Half the bulk rows were stored lowercase and half checksummed; both cases
    // have to come back.
    expect(ids).toContain(`${TEST_PREFIX}bulk_a_0000`);
    expect(ids).toContain(`${TEST_PREFIX}bulk_a_0001`);
    expect(ids).toContain(`${TEST_PREFIX}bulk_a_${String(BULK_NOTIFICATIONS - 1).padStart(4, "0")}`);
  });

  it("gives the other person their own file, symmetrically", async () => {
    const textB = await exportText(USER_B);
    const documentB = JSON.parse(textB) as ExportDocument;

    expect(documentB.complete).toBe(true);
    expect(documentB.data.User.map((row) => row.id)).toEqual([USER_B]);
    expect(textB).not.toContain(USER_A);
    expect(textB).not.toContain(A_WALLET_CHECKSUMMED);
    expect(textB).not.toContain(A_AGENT_PRIVATE_KEY);
    expect(textB).not.toContain(B_AGENT_PRIVATE_KEY);
  }, 60000);
});
