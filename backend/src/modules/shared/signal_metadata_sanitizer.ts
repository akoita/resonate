/**
 * Normalize a user-provided signal metadata string without allowing values to
 * grow beyond the field's existing bound during normalization.
 *
 * The raw length check intentionally happens before any transformation. The
 * angle-bracket pass is a linear scan so an unclosed, tag-shaped value cannot
 * make sanitization repeatedly search the same suffix.
 */
export function sanitizeSignalMetadataString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length > maxLength) {
    return undefined;
  }

  const cleaned = replaceClosedAngleSegments(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || /https?:\/\//i.test(cleaned) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(cleaned)) {
    return undefined;
  }
  if (/\b(?:0x[a-fA-F0-9]{16,}|user[_:-]?[A-Za-z0-9_-]{6,}|session[_:-]?[A-Za-z0-9_-]{6,})\b/.test(cleaned)) {
    return undefined;
  }

  return cleaned;
}

/**
 * Replace each closed `<...>` segment with one space, matching the previous
 * sanitizer's behavior while avoiding a backtracking-prone tag regex.
 *
 * If no closing `>` exists after an opening `<`, the remaining text is kept as
 * ordinary text, as it was by the previous regex implementation.
 */
function replaceClosedAngleSegments(value: string): string {
  const chunks: string[] = [];
  let plainTextStart = 0;
  let cursor = 0;

  while (cursor < value.length) {
    if (value.charCodeAt(cursor) !== 60) {
      cursor += 1;
      continue;
    }

    let close = cursor + 1;
    while (close < value.length && value.charCodeAt(close) !== 62) {
      close += 1;
    }
    if (close === value.length) {
      break;
    }

    chunks.push(value.slice(plainTextStart, cursor), " ");
    plainTextStart = close + 1;
    cursor = close + 1;
  }

  if (chunks.length === 0) {
    return value;
  }

  chunks.push(value.slice(plainTextStart));
  return chunks.join("");
}
