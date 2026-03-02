import { NextRequest, NextResponse } from "next/server";

/**
 * Catch-all proxy for Passkey server requests.
 *
 * AuthProvider sets `passkeyServerUrl: '/api/zerodev/${projectId}'` or
 * `/api/zerodev/self-hosted`, so the SDK calls paths like:
 *   POST /api/zerodev/[projectId]/register/options
 *   POST /api/zerodev/self-hosted/register/options
 *
 * Routing logic:
 *   - If first slug is "self-hosted" → proxy to local NestJS backend
 *   - Otherwise → proxy to ZeroDev's passkeys.zerodev.app
 */

function getZeroDevBase(): string {
    const envUrl = process.env.NEXT_PUBLIC_PASSKEY_SERVER_URL
        || process.env.ZERODEV_PASSKEY_SERVER_URL || "";
    if (envUrl) {
        return envUrl.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i, "");
    }
    return "https://passkeys.zerodev.app/api/v3";
}

function getLocalBackendUrl(): string {
    return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
}

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
    const { slug } = await params;
    const isSelfHosted = slug[0] === "self-hosted";

    let targetUrl: string;

    if (isSelfHosted) {
        // Self-hosted mode: strip "self-hosted" and forward to NestJS backend
        const path = slug.slice(1).join("/");
        targetUrl = `${getLocalBackendUrl()}/api/passkeys/${path}`;
    } else {
        // ZeroDev hosted mode: forward entire slug (includes projectId)
        const path = slug.join("/");
        targetUrl = `${getZeroDevBase()}/${path}`;
    }

    const headers: Record<string, string> = {
        "Content-Type": req.headers.get("content-type") || "application/json",
    };

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

        return new NextResponse(responseText, {
            status: response.status,
            headers: {
                "Content-Type": response.headers.get("content-type") || "application/json",
            },
        });
    } catch (error) {
        console.error(`[Passkey Proxy] Error forwarding to ${targetUrl}:`, error);
        return NextResponse.json(
            { error: "Failed to proxy request to passkey server" },
            { status: 502 }
        );
    }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
