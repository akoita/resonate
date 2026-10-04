import { prisma } from "../db/prisma";
import { SessionOwnerResolver } from "../modules/shared/session_owner.resolver";

const prefix = `sessownerres_${Date.now()}_`;
const userId = `${prefix}user`;
const sessionId = `${prefix}session`;

describe("SessionOwnerResolver", () => {
  const resolver = new SessionOwnerResolver();

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    await prisma.session.create({ data: { id: sessionId, userId, budgetCapUsd: 10, spentUsd: 0 } });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: sessionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("returns the user that owns the session", async () => {
    await expect(resolver.resolveSessionOwner(sessionId)).resolves.toBe(userId);
  });

  it("returns null for an unknown session", async () => {
    await expect(resolver.resolveSessionOwner(`${prefix}missing`)).resolves.toBeNull();
  });

  it("returns null for an empty session id", async () => {
    await expect(resolver.resolveSessionOwner("")).resolves.toBeNull();
  });
});
