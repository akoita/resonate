import { NextRequest, NextResponse } from "next/server";
import { getServerBundlerChainId, getServerBundlerTarget } from "../../../lib/bundlerConfig";

/**
 * Bundler proxy – forwards ERC-4337 JSON-RPC requests to the configured server-side
 * bundler endpoint. Local dev uses Alto at localhost:4337; deployed environments can
 * use AA_BUNDLER / ALTO_BUNDLER_URL / server-side Pimlico credentials without
 * exposing those details to the browser.
 *
 * This avoids CORS issues when the browser (localhost:3001) calls
 * the bundler (localhost:4337) directly.
 *
 * In cloud environments, the browser can still use this route when no public
 * bundler URL or public Pimlico key is configured.
 */

async function proxyBundler(req: NextRequest) {
    const chainId = getServerBundlerChainId();
    const bundlerTarget = getServerBundlerTarget(chainId);

    if (!bundlerTarget) {
        return NextResponse.json(
            { error: "No bundler is configured for this environment" },
            { status: 503 },
        );
    }

    try {
        const body = await req.text();

        const response = await fetch(bundlerTarget, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
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
        console.error(`[Bundler Proxy] Error forwarding to ${bundlerTarget}:`, error);
        return NextResponse.json(
            { error: "Failed to proxy request to bundler" },
            { status: 502 }
        );
    }
}

export const POST = proxyBundler;
