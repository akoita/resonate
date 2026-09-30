/**
 * Track embedding configuration (#1452, WS-5).
 *
 * Provider selection is environment-driven:
 *   TRACK_EMBEDDING_PROVIDER = vertex | hash | disabled
 *   TRACK_EMBEDDING_MODEL    = Vertex text-embedding model id (optional)
 *   TRACK_EMBEDDING_LOCATION = Vertex region (optional)
 * The GCP project reuses the canonical GCP_PROJECT_ID / GOOGLE_CLOUD_PROJECT /
 * GCLOUD_PROJECT chain used by the Pub/Sub runtime.
 */

/** Must match the `TrackEmbedding.vector` column: `vector(768)`. */
export const TRACK_EMBEDDING_DIMENSION = 768;

/** Default Vertex AI model: multilingual, 768 dims by default. */
export const DEFAULT_TRACK_EMBEDDING_MODEL = "text-multilingual-embedding-002";

/** Model id stored with vectors from the deterministic offline hash embedder. */
export const HASH_EMBEDDING_MODEL_ID = "hash-v1";

/** Default Vertex region; same default the SynthID client uses. */
export const DEFAULT_TRACK_EMBEDDING_LOCATION = "us-central1";

/** Vertex allows up to 250 instances per request; we stay well below. */
export const VERTEX_EMBEDDING_BATCH_SIZE = 16;

/** Per-request timeout for Vertex embedding calls. */
export const VERTEX_EMBEDDING_TIMEOUT_MS = 15_000;

export type EmbeddingProviderMode = "vertex" | "hash" | "disabled";

export type EmbeddingProviderConfig =
  | { mode: "disabled"; model: null }
  | { mode: "hash"; model: string }
  | {
      mode: "vertex";
      model: string;
      projectId: string;
      location: string;
    };

export function configuredGcpProjectId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    env.GCP_PROJECT_ID?.trim() ||
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    env.GCLOUD_PROJECT?.trim() ||
    undefined
  );
}

/**
 * Resolve the provider from the environment.
 *
 * Default (variable unset) is `disabled`: Vertex calls are metered, so an
 * operator opts in with `vertex` explicitly. An explicit `vertex` without a
 * project, or an
 * unrecognised value, resolves to `disabled`: embeddings are an enhancement and
 * must never block the catalog. `hash` is the explicit offline/local fallback.
 */
export function resolveEmbeddingProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingProviderConfig {
  const projectId = configuredGcpProjectId(env);
  const requested = env.TRACK_EMBEDDING_PROVIDER?.trim().toLowerCase();
  const mode: EmbeddingProviderMode =
    requested === "vertex" || requested === "hash" || requested === "disabled"
      ? requested
      : "disabled";

  if (mode === "hash") {
    return { mode, model: HASH_EMBEDDING_MODEL_ID };
  }
  if (mode === "vertex" && projectId) {
    return {
      mode,
      model: env.TRACK_EMBEDDING_MODEL?.trim() || DEFAULT_TRACK_EMBEDDING_MODEL,
      projectId,
      location:
        env.TRACK_EMBEDDING_LOCATION?.trim() ||
        DEFAULT_TRACK_EMBEDDING_LOCATION,
    };
  }
  return { mode: "disabled", model: null };
}
