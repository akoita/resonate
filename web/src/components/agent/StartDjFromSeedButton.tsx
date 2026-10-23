"use client";

import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import { DJ_SEED_HREF, queueDjSeed, type DjSeed } from "../../lib/djSeed";

export const START_DJ_FROM_SEED_LABEL = "Start a DJ session from this";

/** Queues `seed` for the AI DJ prompt and opens Home's `#ai-dj` section (#2244). */
export function useStartDjFromSeed() {
    const router = useRouter();
    return (seed: DjSeed) => {
        if (queueDjSeed(seed)) router.push(DJ_SEED_HREF);
    };
}

/** The button used on artist and playlist pages. */
export default function StartDjFromSeedButton({ seed, variant = "ghost" }: { seed: DjSeed; variant?: "ghost" | "primary" }) {
    const start = useStartDjFromSeed();
    return (
        <Button variant={variant} onClick={() => start(seed)}>
            {START_DJ_FROM_SEED_LABEL}
        </Button>
    );
}
