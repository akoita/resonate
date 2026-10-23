/**
 * The mean of several embedding vectors, scaled to unit length, or null when
 * there is nothing usable (no vectors, mixed sizes, or a zero mean). Cosine
 * search ignores the length, so the unit scale only keeps the numbers tidy.
 */
export function unitCentroid(vectors: readonly number[][]): number[] | null {
  const usable = vectors.filter(
    (vector) => vector.length > 0 && vector.every((value) => Number.isFinite(value)),
  );
  if (usable.length === 0) return null;
  const size = usable[0].length;
  const same = usable.filter((vector) => vector.length === size);
  const sum = new Array<number>(size).fill(0);
  for (const vector of same) {
    for (let i = 0; i < size; i += 1) sum[i] += vector[i];
  }
  const norm = Math.sqrt(sum.reduce((total, value) => total + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return null;
  return sum.map((value) => value / norm);
}
