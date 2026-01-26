"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { getArtistMe } from "../../lib/api";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

interface ArtistGateProps {
    children: React.ReactNode;
}

export default function ArtistGate({ children }: ArtistGateProps) {
    const { token, status } = useAuth();
    const [isArtist, setIsArtist] = useState<boolean | null>(null);
    const router = useRouter();

    useEffect(() => {
        async function checkArtist() {
            if (token && status === "authenticated") {
                try {
                    const artist = await getArtistMe(token);
                    setIsArtist(!!artist);
                } catch (error) {
                    console.error("Failed to check artist status:", error);
                    setIsArtist(false);
                }
            } else if (status === "idle" || status === "error") {
                setIsArtist(false);
            }
        }
        checkArtist();
    }, [token, status]);

    if (isArtist === null) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!isArtist) {
        return (
            <div className="max-w-md mx-auto mt-10">
                <Card title="Artist Profile Required">
                    <div className="p-6 text-center">
                        <p className="mb-6 text-muted-foreground">
                            You need an artist profile to upload and manage tracks.
                        </p>
                        <Button onClick={() => router.push("/artist/onboarding")}>
                            Create Artist Profile
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    return <>{children}</>;
}
