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
        const response = await fetch(backendUrl.toString(), {
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Failed to fetch listings:", error);

        // Return empty listings on error (for development without backend)
        return NextResponse.json({
            listings: [],
            total: 0,
            limit: 20,
            offset: 0,
        });
    }
}
