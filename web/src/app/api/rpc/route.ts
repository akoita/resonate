import { NextRequest, NextResponse } from "next/server";
import { getRpcUrl } from "../../../lib/rpc";

async function proxyRpc(req: NextRequest) {
  const targetUrl = getRpcUrl();

  try {
    const body = await req.text();

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": req.headers.get("content-type") || "application/json",
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
    console.error(`[RPC Proxy] Error forwarding to ${targetUrl}:`, error);
    return NextResponse.json(
      { error: "Failed to proxy request to RPC" },
      { status: 502 },
    );
  }
}

export const POST = proxyRpc;
