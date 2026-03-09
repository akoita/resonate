import { NextRequest, NextResponse } from "next/server";

/**
 * Bundler proxy – forwards ERC-4337 JSON-RPC requests to the local Alto
 * bundler running at localhost:4337 (started by `make local-aa-fork`).
 *
 * This avoids CORS issues when the browser (localhost:3001) calls
 * the bundler (localhost:4337) directly.
 *
 * In production, this route is not used — the frontend calls the Pimlico
 * bundler endpoint directly (CORS is handled by Pimlico's servers).
 */

const ALTO_BUNDLER_URL = process.env.ALTO_BUNDLER_URL || "http://localhost:4337";

async function proxyBundler(req: NextRequest) {
    try {
        const body = await req.text();

        const response = await fetch(ALTO_BUNDLER_URL, {
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
        console.error(`[Bundler Proxy] Error forwarding to ${ALTO_BUNDLER_URL}:`, error);
        return NextResponse.json(
            { error: "Failed to proxy request to bundler" },
            { status: 502 }
        );
    }
}

export const POST = proxyBundler;
