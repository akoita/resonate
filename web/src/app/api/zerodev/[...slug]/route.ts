import { NextRequest, NextResponse } from "next/server";

/**
 * Catch-all proxy for ZeroDev passkey server requests.
 *
 * AuthProvider sets `passkeyServerUrl: '/api/zerodev/${projectId}'`,
 * so the SDK calls paths like:
 *   POST /api/zerodev/[projectId]/login/options
 *   POST /api/zerodev/[projectId]/login/verify
 *   POST /api/zerodev/[projectId]/register/options
 *   POST /api/zerodev/[projectId]/register/verify
 *
 * This route forwards them to ZeroDev's hosted passkey server:
 *   https://passkeys.zerodev.app/api/v4/[projectId]/...
 */

// Base URL for ZeroDev passkey server. The slug already contains the projectId,
// so we need just the base (e.g., https://passkeys.zerodev.app/api/v3).
// NEXT_PUBLIC_PASSKEY_SERVER_URL may contain the project ID — strip it.
function getPasskeyServerBase(): string {
    const envUrl = process.env.NEXT_PUBLIC_PASSKEY_SERVER_URL || process.env.ZERODEV_PASSKEY_SERVER_URL || "";
    if (envUrl) {
        // Strip trailing project ID (UUID pattern) if present
        return envUrl.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i, "");
    }
    return "https://passkeys.zerodev.app/api/v3";
}
const ZERODEV_PASSKEY_SERVER = getPasskeyServerBase();

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
    const { slug } = await params;
    const path = slug.join("/");
    const targetUrl = `${ZERODEV_PASSKEY_SERVER}/${path}`;

    const headers: Record<string, string> = {
        "Content-Type": req.headers.get("content-type") || "application/json",
    };

    // Forward authorization header if present
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
        headers["Authorization"] = authHeader;
    }

    try {
        const body = req.method !== "GET" ? await req.text() : undefined;

        const response = await fetch(targetUrl, {
            method: req.method,
            headers,
            body,
        });

        const responseText = await response.text();

        // Try to parse as JSON, otherwise return as-is
        let responseBody: string;
        try {
            JSON.parse(responseText);
            responseBody = responseText;
        } catch {
            responseBody = responseText;
        }

        return new NextResponse(responseBody, {
            status: response.status,
            headers: {
                "Content-Type": response.headers.get("content-type") || "application/json",
            },
        });
    } catch (error) {
        console.error(`[ZeroDev Proxy] Error forwarding to ${targetUrl}:`, error);
        return NextResponse.json(
            { error: "Failed to proxy request to ZeroDev passkey server" },
            { status: 502 }
        );
    }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
