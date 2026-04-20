import { GoogleAuth } from "google-auth-library";

const PUBSUB_SCOPE = "https://www.googleapis.com/auth/pubsub";

export interface PubSubRuntimeConfig {
  enabled: boolean;
  projectId?: string;
  reason?: string;
}

function configuredProjectId(): string | undefined {
  return process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
}

export async function resolvePubSubRuntimeConfig(): Promise<PubSubRuntimeConfig> {
  if (process.env.PUBSUB_EMULATOR_HOST) {
    return {
      enabled: true,
      projectId: configuredProjectId() || "resonate-local",
    };
  }

  const auth = new GoogleAuth({ scopes: [PUBSUB_SCOPE] });

  try {
    await auth.getClient();

    const projectId = configuredProjectId() || await auth.getProjectId().catch(() => undefined);
    if (!projectId) {
      return {
        enabled: false,
        reason:
          "Pub/Sub credentials are available, but no GCP project ID could be resolved. " +
          "Set GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) for backend Pub/Sub usage.",
      };
    }

    return { enabled: true, projectId };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      enabled: false,
      reason:
        "No Pub/Sub auth detected. Set PUBSUB_EMULATOR_HOST for local dev, " +
        "or provide Application Default Credentials via an attached Cloud Run service account, " +
        "GOOGLE_APPLICATION_CREDENTIALS, or `gcloud auth application-default login`. " +
        `Underlying error: ${detail}`,
    };
  }
}
