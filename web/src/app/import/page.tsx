"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The old file-by-file import copied every audio file into browser storage.
 * Local music now comes from linked folders in Settings › Library, which read
 * files from disk without copying them (#2503). Keep the route for old links.
 */
export default function ImportPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace("/settings?section=library");
    }, [router]);
    return null;
}
