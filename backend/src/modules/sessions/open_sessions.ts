import { prisma } from "../../db/prisma";

export interface EndedSession {
  id: string;
  startedAt: Date;
  spentUsd: number;
  budgetCapUsd: number;
}

/**
 * Ends every session the listener still has open and returns them, so the
 * caller can drop their in-memory state and announce the end.
 *
 * A listener has at most one AI DJ session open at a time: starting a new one
 * ends the old one rather than refusing, so a reload, a crash or a second
 * device never leaves someone locked out. It also bounds what one account can
 * keep running.
 *
 * Only sessions this call actually closed are returned: the update is guarded
 * by `endedAt: null`, so two overlapping calls never both report the same one.
 */
export async function endOpenSessions(userId: string, now: Date = new Date()): Promise<EndedSession[]> {
  const open = await prisma.session.findMany({
    where: { userId, endedAt: null },
    select: { id: true, startedAt: true, spentUsd: true, budgetCapUsd: true },
    orderBy: { startedAt: "asc" },
  });
  const ended: EndedSession[] = [];
  for (const session of open) {
    const { count } = await prisma.session.updateMany({
      where: { id: session.id, endedAt: null },
      data: { endedAt: now },
    });
    if (count === 1) ended.push(session);
  }
  return ended;
}
