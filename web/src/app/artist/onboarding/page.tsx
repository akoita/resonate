"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/auth/AuthProvider";
import { createArtist } from "../../../lib/api";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { useToast } from "../../../components/ui/Toast";
import AuthGate from "../../../components/auth/AuthGate";

export default function ArtistOnboardingPage() {
    const { token, address } = useAuth();
    const router = useRouter();
    const { addToast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        displayName: "",
        payoutAddress: address || "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;

        if (!formData.displayName.trim()) {
            addToast({
                type: "error",
                title: "Display Name Required",
                message: "Please enter your artist name.",
            });
            return;
        }

        setIsSubmitting(true);
        try {
            await createArtist(token, {
                displayName: formData.displayName,
                payoutAddress: formData.payoutAddress || address || "",
            });
            addToast({
                type: "success",
                title: "Profile Created!",
                message: "Welcome to Resonate! You can now upload your music.",
            });
            router.push("/artist/upload");
        } catch (error) {
            addToast({
                type: "error",
                title: "Failed to create profile",
                message: "Something went wrong. Please try again.",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AuthGate title="Connect your wallet to become an artist.">
            <div className="max-w-xl mx-auto py-10">
                <Card title="Register as an Artist">
                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        <p className="text-muted-foreground">
                            To start uploading music, you first need to create an artist profile.
                        </p>

                        <label className="block space-y-2">
                            <span className="text-sm font-medium">Artist Display Name</span>
                            <Input
                                placeholder="e.g. Aya Lune"
                                value={formData.displayName}
                                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                            />
                        </label>

                        <label className="block space-y-2">
                            <span className="text-sm font-medium">Payout Address</span>
                            <Input
                                placeholder="0x..."
                                value={formData.payoutAddress}
                                onChange={(e) => setFormData({ ...formData, payoutAddress: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">
                                This is where you will receive your earnings. Defaults to your connected wallet.
                            </p>
                        </label>

                        <Button type="submit" disabled={isSubmitting} className="w-full">
                            {isSubmitting ? "Creating Profile..." : "Create Artist Profile"}
                        </Button>
                    </form>
                </Card>
            </div>
        </AuthGate>
    );
}
