"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../components/auth/AuthProvider";
import { createArtist, getArtistMe } from "../../../lib/api";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { useToast } from "../../../components/ui/Toast";
import AuthGate from "../../../components/auth/AuthGate";
import HumanVerificationCard from "../../../components/disputes/HumanVerificationCard";

export default function ArtistOnboardingPage() {
  const { token, address } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [addressFocused, setAddressFocused] = useState(false);
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

  // Generate avatar initials from display name
  const initials = formData.displayName.trim()
    ? formData.displayName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "";

  const isPayoutFromWallet = formData.payoutAddress === address;

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
          {/* Top accent line */}
          <div className="card-accent-line" />

          {/* Step indicator */}
          <div className="step-indicator">
            <div className="step-dot active" />
            <div className="step-line" />
            <div className="step-dot" />
            <span className="step-label">Step 1 of 2</span>
          </div>

          {/* Header with avatar preview */}
          <div className="onboarding-header">
            <div className="avatar-preview">
              {initials ? (
                <span className="avatar-initials">{initials}</span>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </div>
            <h1 className="onboarding-title">Create your profile</h1>
            <p className="onboarding-description">
              Set up your artist identity to start uploading and monetizing your stems.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="onboarding-form">
            {/* Artist Display Name */}
            <div className="input-group">
              <label className="input-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Artist Display Name
              </label>
              <div className={`input-wrapper ${nameFocused ? "focused" : ""}`}>
                <Input
                  className="premium-input"
                  placeholder="e.g. Aya Lune"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  maxLength={50}
                  required
                />
              </div>
              <div className="input-hint-row">
                <p className="input-hint">
                  {formData.displayName.trim()
                    ? "This name will be visible to your fans."
                    : "Enter your artist name to complete registration."}
                </p>
                {formData.displayName.length > 0 && (
                  <span className="char-count">{formData.displayName.length}/50</span>
                )}
              </div>
            </div>

            {/* Payout Address */}
            <div className="input-group">
              <label className="input-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                </svg>
                Payout Address (USDC)
                {isPayoutFromWallet && (
                  <span className="auto-fill-badge">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Auto-filled
                  </span>
                )}
              </label>
              <div className={`input-wrapper ${addressFocused ? "focused" : ""}`}>
                <Input
                  className="premium-input mono-font"
                  placeholder="0x..."
                  value={formData.payoutAddress}
                  onChange={(e) => setFormData({ ...formData, payoutAddress: e.target.value })}
                  onFocus={() => setAddressFocused(true)}
                  onBlur={() => setAddressFocused(false)}
                />
              </div>
              <p className="input-hint">
                Earnings will be sent here. Defaults to your connected wallet.
              </p>
            </div>

            {/* What you'll get section */}
            <div className="perks-section">
              <div className="perk-item">
                <div className="perk-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
                <span>Upload &amp; split stems</span>
              </div>
              <div className="perk-item">
                <div className="perk-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 3h12l4 6-10 13L2 9z" />
                    <path d="M2 9h20" />
                  </svg>
                </div>
                <span>Mint stem NFTs</span>
              </div>
              <div className="perk-item">
                <div className="perk-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <span>Earn royalties on-chain</span>
              </div>
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

          {/* Divider */}
          {address && (
            <>
              <div className="section-divider">
                <div className="divider-line" />
                <span className="divider-label">Optional</span>
                <div className="divider-line" />
              </div>
              <HumanVerificationCard walletAddress={address} compact />
            </>
          )}
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
          background: linear-gradient(170deg, rgba(18, 22, 35, 0.85) 0%, rgba(10, 12, 18, 0.92) 100%);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 24px;
          padding: 3rem;
          box-shadow:
            0 25px 60px -12px rgba(0, 0, 0, 0.5),
            0 0 0 1px rgba(255, 255, 255, 0.04) inset,
            0 0 80px rgba(124, 92, 255, 0.04);
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
          overflow: hidden;
        }

        .card-accent-line {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, #7c5cff, #00d1ff, transparent);
          opacity: 0.5;
          border-radius: 24px 24px 0 0;
        }

        /* Step indicator */
        .step-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-bottom: 2rem;
        }

        .step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.12);
          transition: all 0.3s;
        }

        .step-dot.active {
          width: 10px;
          height: 10px;
          background: #7c5cff;
          box-shadow: 0 0 10px rgba(124, 92, 255, 0.4);
        }

        .step-line {
          width: 40px;
          height: 2px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 1px;
        }

        .step-label {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(255, 255, 255, 0.3);
          margin-left: 8px;
        }

        /* Header */
        .onboarding-header {
          text-align: center;
          margin-bottom: 2.5rem;
        }

        .avatar-preview {
          width: 72px;
          height: 72px;
          margin: 0 auto 1.25rem;
          border-radius: 50%;
          background: rgba(124, 92, 255, 0.08);
          border: 2px solid rgba(124, 92, 255, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          animation: avatarPulse 3s ease-in-out infinite;
        }

        .avatar-initials {
          font-size: 1.5rem;
          font-weight: 800;
          color: #a78bfa;
          letter-spacing: 0.02em;
        }

        .onboarding-title {
          font-size: 2rem;
          font-weight: 800;
          color: white;
          margin-bottom: 0.75rem;
          letter-spacing: -0.02em;
        }

        .onboarding-description {
          color: rgba(255, 255, 255, 0.45);
          line-height: 1.6;
          font-size: 0.95rem;
          max-width: 380px;
          margin: 0 auto;
        }

        /* Form */
        .onboarding-form {
          display: grid;
          gap: 1.75rem;
        }

        .input-group {
          display: grid;
          gap: 0.5rem;
        }

        .input-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.85rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.75);
          padding-left: 0.125rem;
        }

        .auto-fill-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-left: auto;
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 0.65rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .input-wrapper {
          position: relative;
          border-radius: 14px;
          transition: box-shadow 0.3s;
        }

        .input-wrapper.focused {
          box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.2), 0 0 24px rgba(124, 92, 255, 0.06);
        }

        .input-wrapper :global(.premium-input) {
          background: rgba(255, 255, 255, 0.03) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          border-radius: 14px !important;
          padding: 0.875rem 1rem !important;
          font-size: 0.95rem !important;
          transition: all 0.2s !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }

        .input-wrapper.focused :global(.premium-input) {
          border-color: rgba(124, 92, 255, 0.35) !important;
          background: rgba(255, 255, 255, 0.04) !important;
        }

        .input-wrapper :global(.mono-font) {
          font-family: 'JetBrains Mono', 'SF Mono', monospace !important;
          font-size: 0.85rem !important;
        }

        .input-hint-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 0.25rem;
        }

        .input-hint {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.3);
          margin: 0;
        }

        .char-count {
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.2);
          font-variant-numeric: tabular-nums;
        }

        /* Perks section */
        .perks-section {
          display: flex;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }

        .perk-item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.5);
          white-space: nowrap;
        }

        .perk-icon {
          color: rgba(124, 92, 255, 0.6);
          display: flex;
        }

        /* Submit button */
        .onboarding-submit-btn {
          height: 52px !important;
          border-radius: 14px !important;
          font-size: 1rem !important;
          font-weight: 600 !important;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
          background: linear-gradient(135deg, #7c5cff 0%, #6d4fe8 50%, #00b8d9 100%) !important;
          border: none !important;
          box-shadow: 0 8px 24px -4px rgba(124, 92, 255, 0.35) !important;
        }

        .onboarding-submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px -4px rgba(124, 92, 255, 0.45) !important;
        }

        .onboarding-submit-btn:disabled {
          opacity: 0.45 !important;
          cursor: not-allowed !important;
          box-shadow: none !important;
        }

        .btn-content {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.625rem;
        }

        /* Section divider */
        .section-divider {
          display: flex;
          align-items: center;
          gap: 14px;
          margin: 2rem 0 1.5rem;
        }

        .divider-line {
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
        }

        .divider-label {
          font-size: 0.65rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: rgba(255, 255, 255, 0.2);
        }

        /* Background */
        .onboarding-blob-1, .onboarding-blob-2 {
          position: absolute;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          filter: blur(130px);
          z-index: 1;
          opacity: 0.12;
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
          100% { transform: translate(80px, 40px) scale(1.08); }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes avatarPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(124, 92, 255, 0.1); }
          50% { box-shadow: 0 0 0 8px rgba(124, 92, 255, 0); }
        }

        .spinner {
          width: 18px;
          height: 18px;
          border: 2.5px solid rgba(255, 255, 255, 0.25);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 600px) {
          .onboarding-glass-card {
            padding: 2rem 1.5rem;
            border-radius: 20px;
          }

          .onboarding-title {
            font-size: 1.625rem;
          }

          .perks-section {
            flex-direction: column;
          }

          .avatar-preview {
            width: 60px;
            height: 60px;
          }

          .avatar-initials {
            font-size: 1.25rem;
          }
        }
      `}</style>
    </AuthGate>
  );
}
