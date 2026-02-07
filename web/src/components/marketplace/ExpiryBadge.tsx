"use client";

import { useState, useEffect } from "react";

interface ExpiryBadgeProps {
    expiresAt: string;
}

function getTimeRemaining(expiresAt: string) {
    const now = Date.now();
    const expiry = new Date(expiresAt).getTime();
    const diff = expiry - now;

    if (diff <= 0) return { label: "Expired", urgency: "expired" as const };

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 7) return { label: `${days}d left`, urgency: "calm" as const };
    if (days >= 1) return { label: `${days}d ${hours}h left`, urgency: "warning" as const };
    if (hours >= 1) return { label: `${hours}h ${minutes}m left`, urgency: "urgent" as const };
    return { label: "Ending soon!", urgency: "critical" as const };
}

export function ExpiryBadge({ expiresAt }: ExpiryBadgeProps) {
    const [time, setTime] = useState(() => getTimeRemaining(expiresAt));

    useEffect(() => {
        const interval = setInterval(() => {
            setTime(getTimeRemaining(expiresAt));
        }, 60_000); // update every minute
        return () => clearInterval(interval);
    }, [expiresAt]);

    return (
        <span className={`expiry-badge expiry-badge--${time.urgency}`} title={`Expires: ${new Date(expiresAt).toLocaleString()}`}>
            ⏱ {time.label}
        </span>
    );
}
