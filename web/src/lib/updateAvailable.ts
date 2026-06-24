// Pure helper for the "update available" check, kept framework-free so it is
// trivially unit-testable. A new deployment is available when the running
// build's version differs from the version the live server reports — but never
// while running the unbuilt placeholder ("dev"), so local dev never prompts.
export const DEV_BUILD_VERSION = "dev";

export function isUpdateAvailable(buildVersion: string, deployedVersion: string | null): boolean {
  if (buildVersion === DEV_BUILD_VERSION) return false;
  if (deployedVersion == null || deployedVersion === DEV_BUILD_VERSION) return false;
  return deployedVersion !== buildVersion;
}
