"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../components/auth/AuthProvider";
import { createArtist, getArtistMe } from "../../../lib/api";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { useToast } from "../../../components/ui/Toast";
import AuthGate from "../../../components/auth/AuthGate";

export default function ArtistOnboardingPage() {
  const { token, address } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    displayName: "",
    payoutAddress: address || "",
  });

  // Check if user already has an artist profile
  useEffect(() => {
    async function checkExistingArtist() {
      if (token) {
        try {
          const artist = await getArtistMe(token);
          if (artist) {
            const returnUrl = searchParams.get("returnUrl");
            router.push(returnUrl || "/artist/upload");
            return;
          }
        } catch (err) {
          console.error("Failed to check artist profile:", err);
        }
      }
      setIsLoading(false);
    }
    checkExistingArtist();
  }, [token, router, searchParams]);

  // Keep payout address in sync with wallet
  useEffect(() => {
    if (address && !formData.payoutAddress) {
      setFormData(prev => ({ ...prev, payoutAddress: address }));
    }
  }, [address, formData.payoutAddress]);

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
        title: "Welcome to Resonate!",
        message: "Your artist profile has been created successfully.",
      });
      const returnUrl = searchParams.get("returnUrl");
      router.push(returnUrl || "/artist/upload");
    } catch (err) {
      addToast({
        type: "error",
        title: "Failed to create profile",
        message: err instanceof Error ? err.message : "Something went wrong. Please check your connection and try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <AuthGate title="Connect your wallet to begin your journey.">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate title="Connect your wallet to begin your journey.">
      <div className="onboarding-container">
        <div className="onboarding-glass-card">
          <div className="onboarding-header">
            <div className="onboarding-badge">Artist Onboarding</div>
            <h1 className="onboarding-title">Create your profile</h1>
            <p className="onboarding-description">
              Join the future of music distribution. Set up your artist identity to start uploading tracks.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="onboarding-form">
            <div className="input-group">
              <label className="input-label">Artist Display Name</label>
              <div className="input-wrapper">
                <Input
                  className="premium-input"
                  placeholder="e.g. Aya Lune"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                />
                <div className="input-glow"></div>
              </div>
              <p className="input-hint">This name will be visible to your fans.</p>
            </div>

            <div className="input-group">
              <label className="input-label">Payout Address (USDC)</label>
              <div className="input-wrapper">
                <Input
                  className="premium-input mono-font"
                  placeholder="0x..."
                  value={formData.payoutAddress}
                  onChange={(e) => setFormData({ ...formData, payoutAddress: e.target.value })}
                />
                <div className="input-glow"></div>
              </div>
              <p className="input-hint">
                Earnings will be sent here. Defaults to your connected wallet.
              </p>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              variant="primary"
              className="onboarding-submit-btn"
            >
              <span className="btn-content">
                {isSubmitting ? (
                  <>
                    <span className="spinner"></span>
                    Registering...
                  </>
                ) : (
                  <>
                    Complete Registration
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </>
                )}
              </span>
            </Button>
          </form>
        </div>

        {/* Decorative background elements */}
        <div className="onboarding-blob-1"></div>
        <div className="onboarding-blob-2"></div>
      </div>

      <style jsx>{`
        .onboarding-container {
          position: relative;
          min-height: calc(100vh - 200px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          overflow: hidden;
        }

        .onboarding-glass-card {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 540px;
          background: rgba(13, 17, 23, 0.7);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          padding: 3rem;
          box-shadow: 
            0 25px 50px -12px rgba(0, 0, 0, 0.5),
            0 0 0 1px rgba(255, 255, 255, 0.05) inset;
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .onboarding-header {
          text-align: center;
          margin-bottom: 2.5rem;
        }

        .onboarding-badge {
          display: inline-block;
          padding: 0.5rem 1rem;
          background: rgba(124, 92, 255, 0.1);
          color: #9b7bff;
          border-radius: 99px;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin-bottom: 1.5rem;
          border: 1px solid rgba(124, 92, 255, 0.2);
        }

        .onboarding-title {
          font-size: 2.25rem;
          font-weight: 800;
          color: white;
          margin-bottom: 1rem;
          letter-spacing: -0.02em;
        }

        .onboarding-description {
          color: var(--color-muted);
          line-height: 1.6;
          font-size: 1.05rem;
        }

        .onboarding-form {
          display: grid;
          gap: 2rem;
        }

        .input-group {
          display: grid;
          gap: 0.75rem;
        }

        .input-label {
          font-size: 0.9rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
          padding-left: 0.25rem;
        }

        .input-wrapper {
          position: relative;
        }

        .input-wrapper :global(.premium-input) {
          background: rgba(255, 255, 255, 0.03) !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          height: 12px !important;
          border-radius: 12px !important;
          padding: 1.5rem 1rem !important;
          font-size: 1rem !important;
          transition: all 0.3s ease !important;
        }

        .input-wrapper :global(.premium-input:focus) {
          border-color: rgba(124, 92, 255, 0.5) !important;
          background: rgba(255, 255, 255, 0.05) !important;
          box-shadow: 0 0 20px rgba(124, 92, 255, 0.1) !important;
        }

        .mono-font {
          font-family: 'JetBrains Mono', monospace !important;
          font-size: 0.9rem !important;
        }

        .input-hint {
          font-size: 0.8rem;
          color: var(--color-muted);
          padding-left: 0.5rem;
        }

        .onboarding-submit-btn {
          margin-top: 1rem;
          height: 56px !important;
          border-radius: 14px !important;
          font-size: 1.1rem !important;
          font-weight: 600 !important;
          transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
          background: linear-gradient(135deg, #7c5cff 0%, #00d1ff 100%) !important;
          border: none !important;
          box-shadow: 0 10px 20px -5px rgba(124, 92, 255, 0.4) !important;
        }

        .onboarding-submit-btn:hover {
          transform: translateY(-4px) scale(1.02);
          box-shadow: 0 15px 30px -5px rgba(124, 92, 255, 0.5) !important;
        }

        .btn-content {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
        }

        .onboarding-blob-1, .onboarding-blob-2 {
          position: absolute;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          filter: blur(120px);
          z-index: 1;
          opacity: 0.15;
          pointer-events: none;
        }

        .onboarding-blob-1 {
          top: -100px;
          left: -100px;
          background: #7c5cff;
          animation: float 20s infinite alternate;
        }

        .onboarding-blob-2 {
          bottom: -100px;
          right: -100px;
          background: #00d1ff;
          animation: float 25s infinite alternate-reverse;
        }

        @keyframes float {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(100px, 50px) scale(1.1); }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .spinner {
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </AuthGate>
  );
}
