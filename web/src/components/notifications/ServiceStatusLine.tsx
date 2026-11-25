"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getServiceStatus, type ServiceStatus } from "../../lib/api";

const CACHE_MS = 60_000;
let cached: { at: number; value: Promise<ServiceStatus | null> } | null = null;

/** One request per minute at most, however many gates are on screen. A failure shows nothing. */
function loadServiceStatus(): Promise<ServiceStatus | null> {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) {
    cached = {
      at: now,
      value: getServiceStatus()
        .then((result) => result?.status ?? null)
        .catch(() => null),
    };
  }
  return cached.value;
}

/**
 * The public service status (#2667) on the sign-in screen, so people who
 * cannot sign in still learn that something is wrong. Renders nothing when
 * there is no active status.
 */
export default function ServiceStatusLine() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadServiceStatus().then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;
  return (
    <div className="service-status-line" role="status">
      <p className="service-status-line__title">{status.title}</p>
      <p className="service-status-line__body">{status.body}</p>
      <p className="service-status-line__more">
        Still stuck? <Link href="/support">Contact support</Link>
      </p>
    </div>
  );
}
