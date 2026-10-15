import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * POST /api/contracts/notify-listing
 * Record a listing intent (license tier per listing) and notify connected
 * clients. Proxies the body unchanged — including multi-tier `tiers` — and
 * the Authorization header to the backend, which broadcasts via WebSocket.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // The backend requires sign-in (#2041): forward the caller's token.
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const authorization = request.headers.get("authorization");
        if (authorization) {
            headers.Authorization = authorization;
        }

        const res = await fetch(`${API_BASE}/metadata/notify-listing`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.text();
            return NextResponse.json({ error: err }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("notify-listing proxy error:", error);
        return NextResponse.json({ error: "Failed to notify" }, { status: 500 });
    }
}
