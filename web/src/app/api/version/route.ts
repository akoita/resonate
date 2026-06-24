import { BUILD_VERSION } from "../../../lib/buildVersion";

// Reflects the version of the build currently serving the request, so an
// already-loaded client can poll this and notice when a newer build is live.
// Must never be cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return new Response(JSON.stringify({ version: BUILD_VERSION }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
