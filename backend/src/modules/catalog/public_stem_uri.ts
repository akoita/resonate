/**
 * Public catalog responses never carry a storage location (#2661).
 *
 * A stem's `uri` names its archive file. Public reads replace it with the
 * backend route a listener may play: the stem's streaming rendition
 * (`/catalog/stems/<id>/blob`) or, for an official stem, its lossy preview
 * (`/catalog/stems/<id>/preview`). Encrypted stems keep their URI: the bytes
 * there are ciphertext, and the purchase flow needs the location.
 */
export function publicStemUri(stem: { id: string; source?: string | null }): string {
  return stem.source === "official"
    ? `/catalog/stems/${stem.id}/preview`
    : `/catalog/stems/${stem.id}/blob`;
}

const MAX_DEPTH = 12;

/** Returns a copy of `value` with every `stems[].uri` rewritten for the public. */
export function withPublicStemUris<T>(value: T): T {
  return rewrite(value, 0) as T;
}

function rewrite(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => rewrite(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = key === "stems" && Array.isArray(child)
      ? child.map((stem) => rewriteStem(rewrite(stem, depth + 1)))
      : rewrite(child, depth + 1);
  }
  return out;
}

function rewriteStem(stem: unknown): unknown {
  if (!isPlainObject(stem)) return stem;
  const record = stem as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.uri !== "string") return stem;
  if (record.isEncrypted === true) return stem;
  return { ...record, uri: publicStemUri({ id: record.id, source: record.source as string | null }) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
