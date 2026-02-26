import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * POST /api/contracts/notify-listing
 * Notify all connected clients about a new listing.
 * Proxies to backend which broadcasts via WebSocket.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const res = await fetch(`${API_BASE}/metadata/notify-listing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
