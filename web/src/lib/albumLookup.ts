/**
 * "Look up details" in Edit album (#2538): which form fields a picked
 * MusicBrainz release may fill.
 *
 * Only year, genre and label, and only when the field is empty for the whole
 * album. A value the listener typed, a file tag, or a field that differs
 * between tracks ("Mixed") is never replaced.
 */
import type { AlbumLookupDetails } from "./api";

export const LOOKUP_FIELDS = ["year", "genre", "label"] as const;
export type LookupField = (typeof LOOKUP_FIELDS)[number];

export const LOOKUP_FIELD_LABELS: Record<LookupField, string> = { year: "year", genre: "genre", label: "label" };

export function fillEmptyFields(
    values: Record<string, string>,
    mixed: (key: LookupField) => boolean,
    details: Pick<AlbumLookupDetails, LookupField>,
): { values: Record<string, string>; filled: LookupField[] } {
    const next = { ...values };
    const filled: LookupField[] = [];
    for (const key of LOOKUP_FIELDS) {
        const found = details[key];
        if (found === null || found === undefined || String(found).trim() === "") continue;
        if (mixed(key) || (values[key] ?? "").trim() !== "") continue;
        next[key] = String(found);
        filled.push(key);
    }
    return { values: next, filled };
}

/** "Filled year and genre." / "Filled year, genre and label." */
export function describeFilled(filled: LookupField[]): string {
    const names = filled.map((key) => LOOKUP_FIELD_LABELS[key]);
    if (names.length === 0) return "";
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `Filled ${list}.`;
}
