"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CollectionPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/library?tab=stems");
    }, [router]);

    return (
        <div className="flex items-center justify-center h-screen">
            <div className="text-center">
                <h1 className="text-2xl font-bold mb-4">Redirecting to Library...</h1>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
            </div>
        </div>
    );
}
