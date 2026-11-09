/**
 * Stored audio that belongs to one unpublished remix project (#2600).
 *
 * Used when a project is removed because its source release was deleted: the
 * current draft, its rendered stems (#2550), every archived version (#1320)
 * and its stems. Publish copies a draft into a catalogue-owned object, so
 * none of these is ever the audio of a published release.
 *
 * Reads the metadata shapes defensively; a malformed entry is skipped.
 */
import { renderedStemUris } from "./remix-stems";

function isUri(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function remixDraftStorageUris(generationMetadata: unknown): string[] {
  if (!generationMetadata || typeof generationMetadata !== "object") return [];
  const metadata = generationMetadata as {
    output?: { outputUri?: unknown } | null;
    stems?: unknown;
    previousDrafts?: unknown;
  };
  const uris = new Set<string>();

  if (isUri(metadata.output?.outputUri)) uris.add(metadata.output.outputUri);
  for (const uri of renderedStemUris(metadata.stems)) {
    if (isUri(uri)) uris.add(uri);
  }

  if (Array.isArray(metadata.previousDrafts)) {
    for (const entry of metadata.previousDrafts) {
      if (!entry || typeof entry !== "object") continue;
      const version = entry as {
        output?: { outputUri?: unknown } | null;
        stemUris?: unknown;
      };
      if (isUri(version.output?.outputUri)) uris.add(version.output.outputUri);
      if (Array.isArray(version.stemUris)) {
        for (const uri of version.stemUris) {
          if (isUri(uri)) uris.add(uri);
        }
      }
    }
  }
  return [...uris];
}
