export function extractZeroDevProjectIdFromPasskeyServerUrl(url?: string | null) {
  if (!url) return null;
  const match = url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  return match?.[1] ?? null;
}

export function getZeroDevProjectId(explicitProjectId?: string | null) {
  return (
    explicitProjectId ||
    process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ||
    extractZeroDevProjectIdFromPasskeyServerUrl(process.env.NEXT_PUBLIC_PASSKEY_SERVER_URL) ||
    null
  );
}

export function getPasskeyServerUrl(projectId?: string | null) {
  const resolvedProjectId = getZeroDevProjectId(projectId);
  return resolvedProjectId
    ? `/api/zerodev/${resolvedProjectId}`
    : "/api/zerodev/self-hosted";
}

export function getPasskeyRpId() {
  const configured = process.env.NEXT_PUBLIC_PASSKEY_RP_ID?.trim();
  if (configured) return configured;
  return typeof window !== "undefined" ? window.location.hostname : undefined;
}
