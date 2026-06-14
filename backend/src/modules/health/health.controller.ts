import { Controller, Get } from "@nestjs/common";

/**
 * Resolves the deployed app version: explicit `APP_VERSION` (set at deploy)
 * wins; otherwise the backend package version, so a build is always
 * identifiable. Read once at module load.
 */
function resolveAppVersion(): string {
  const fromEnv = process.env.APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../../../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const APP_VERSION = resolveAppVersion();

export type HealthResponse = {
  status: "ok";
  appVersion: string;
  /**
   * Stable identity of THIS backend environment. The client stores the last
   * value it saw and prompts a guided session reset when it changes — i.e.
   * when the app is pointed at a new/reset environment (#1199, precursor to
   * the state migration in #915). Defaults to "local" for dev.
   */
  environmentId: string;
  /**
   * Bumped when data is reset/migrated within the same environment, so the
   * same guided reset fires without changing environmentId. Defaults to "1".
   */
  dataEpoch: string;
};

@Controller("health")
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: "ok",
      appVersion: APP_VERSION,
      environmentId: process.env.RESONATE_ENVIRONMENT_ID?.trim() || "local",
      dataEpoch: process.env.RESONATE_DATA_EPOCH?.trim() || "1",
    };
  }
}
