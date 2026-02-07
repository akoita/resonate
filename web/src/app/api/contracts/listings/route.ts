import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

/**
 * Proxy listings requests to backend metadata API
 * GET /api/contracts/listings -> backend /api/metadata/listings
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    // Forward all query params to backend
    const backendUrl = new URL("/metadata/listings", BACKEND_URL);
    searchParams.forEach((value, key) => {
        backendUrl.searchParams.append(key, value);
    });

    try {
        console.log(`[listings proxy] Fetching from backend: ${backendUrl.toString()}`);
        const response = await fetch(backendUrl.toString(), {
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            console.error(`[listings proxy] Backend returned ${response.status}: ${body}`);
            return NextResponse.json(
                { error: `Backend returned ${response.status}`, listings: [], total: 0 },
                { status: 502 }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("[listings proxy] Failed to reach backend:", error);

        return NextResponse.json(
            {
                error: "Backend unreachable",
                details: error instanceof Error ? error.message : String(error),
                listings: [],
                total: 0,
            },
            { status: 502 }
        );
    }
}
