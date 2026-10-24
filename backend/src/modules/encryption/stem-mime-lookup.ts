import { prisma } from "../../db/prisma";

/**
 * The stored MIME type of the stem at `uri` (`Stem.mimeType`, #1976), or null
 * when there is no such stem or the lookup fails. `POST /encryption/decrypt`
 * receives only a URI, so it asks here which format the stem was stored in
 * (MP3 for separated stems, WAV or FLAC for official ones). A failed lookup
 * must never fail a decryption: the caller falls back to the MP3 default.
 */
export async function lookupStemMimeType(uri: string): Promise<string | null> {
  try {
    const stem = await prisma.stem.findFirst({ where: { uri }, select: { mimeType: true } });
    return stem?.mimeType ?? null;
  } catch {
    return null;
  }
}
