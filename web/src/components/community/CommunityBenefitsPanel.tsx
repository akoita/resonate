"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getMyCommunityBenefits,
  redeemCommunityBenefit,
  type CommunityBenefit,
  type CommunityBenefitsResponse,
} from "../../lib/api";
import { Button } from "../ui/Button";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message?: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

type CommunityBenefitsContentProps = {
  response: CommunityBenefitsResponse | null;
  loading: boolean;
  error: string | null;
  redeemingId: string | null;
  onRefresh: () => void;
  onRedeem: (benefit: CommunityBenefit) => void;
};

export type CommunityBenefitState = "redeemable" | "redeemed" | "locked" | "unavailable";

export function communityBenefitState(benefit: CommunityBenefit): CommunityBenefitState {
  if (benefit.redeemed) return "redeemed";
  if (benefit.eligible && benefit.redeemable) return "redeemable";
  if (!benefit.eligible) return "locked";
  return "unavailable";
}

export function communityBenefitTypeLabel(type: string) {
  const labels: Record<string, string> = {
    room_access: "Room access",
    discount: "Discount",
    early_access: "Early access",
    fee_discount: "Fee discount",
    drop_priority: "Drop priority",
    ticket_priority: "Ticket priority",
    remix_eligibility: "Remix eligibility",
  };
  return labels[type] ?? "Benefit";
}

export function communityBenefitStatusCopy(benefit: CommunityBenefit) {
  const state = communityBenefitState(benefit);
  if (state === "redeemable") {
    return {
      label: "Unlocked",
      body: "Your eligibility was checked privately. You can claim this benefit now.",
    };
  }
  if (state === "redeemed") {
    return {
      label: "Redeemed",
      body: benefit.redeemedAt
        ? `Redeemed ${formatBenefitDate(benefit.redeemedAt)}.`
        : "This benefit has already been redeemed.",
    };
  }
  if (state === "locked") {
    return {
      label: "Locked",
      body: "Not currently available for this account. Proof details stay private.",
    };
  }
  return {
    label: "Unavailable",
    body: "This benefit is not currently claimable.",
  };
}

export function partitionCommunityBenefits(benefits: CommunityBenefit[]) {
  return {
    redeemable: benefits.filter((benefit) => communityBenefitState(benefit) === "redeemable"),
    redeemed: benefits.filter((benefit) => communityBenefitState(benefit) === "redeemed"),
    locked: benefits.filter((benefit) => communityBenefitState(benefit) === "locked"),
    unavailable: benefits.filter((benefit) => communityBenefitState(benefit) === "unavailable"),
  };
}

function formatBenefitDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function replaceBenefit(benefits: CommunityBenefit[], next: CommunityBenefit) {
  return benefits.map((benefit) => (benefit.id === next.id ? next : benefit));
}

export default function CommunityBenefitsPanel({ token, addToast }: Props) {
  const [response, setResponse] = useState<CommunityBenefitsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setResponse(await getMyCommunityBenefits(token));
    } catch {
      setError("Could not load your unlocked benefits.");
      addToast({
        type: "error",
        title: "Benefits unavailable",
        message: "Please refresh and try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token changes are the reload boundary.
  }, [token]);

  const handleRedeem = async (benefit: CommunityBenefit) => {
    if (!token) return;
    setRedeemingId(benefit.id);
    try {
      const redemption = await redeemCommunityBenefit(token, benefit.id);
      setResponse((current) => current
        ? { ...current, benefits: replaceBenefit(current.benefits, redemption.benefit) }
        : current);
      addToast({
        type: "success",
        title: redemption.idempotent ? "Benefit already claimed" : "Benefit claimed",
        message: redemption.idempotent
          ? "This claim was already recorded for your account."
          : "Your community benefit redemption is recorded.",
      });
    } catch {
      addToast({
        type: "error",
        title: "Claim failed",
        message: "Your eligibility stays private. Refresh and try again.",
      });
    } finally {
      setRedeemingId(null);
    }
  };

  return (
    <CommunityBenefitsContent
      response={response}
      loading={loading}
      error={error}
      redeemingId={redeemingId}
      onRefresh={load}
      onRedeem={handleRedeem}
    />
  );
}

export function CommunityBenefitsContent({
  response,
  loading,
  error,
  redeemingId,
  onRefresh,
  onRedeem,
}: CommunityBenefitsContentProps) {
  const grouped = useMemo(
    () => partitionCommunityBenefits(response?.benefits ?? []),
    [response],
  );
  const totalBenefits = response?.benefits.length ?? 0;

  return (
    <div className="community-benefits">
      <div className="community-benefits__header">
        <div>
          <span className="settings-kicker">Unlocked benefits</span>
          <h2>Benefits for your listener account</h2>
          <p>
            Claim private holder, supporter, collector, and role-based benefits without exposing wallet or proof details.
          </p>
        </div>
        <Button variant="ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {response ? (
        <div className="community-benefits__privacy" aria-label="Benefit privacy">
          <span>Proofs private</span>
          <span>Wallet {response.privacy.walletAddressVisible ? "visible by profile setting" : "hidden"}</span>
          <span>Ownership {response.privacy.ownershipDisplayVisible ? "visible by profile setting" : "hidden"}</span>
        </div>
      ) : null}

      {loading && !response ? (
        <div className="listener-cohorts-state">Loading unlocked benefits...</div>
      ) : null}

      {error ? (
        <div className="listener-cohorts-state listener-cohorts-state--locked">
          <strong>Benefits unavailable</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {!loading && response && totalBenefits === 0 ? (
        <div className="listener-cohorts-state">
          <strong>No unlocked benefits yet</strong>
          <p>Benefits appear here when artists or operators activate rules that your private community proofs satisfy.</p>
        </div>
      ) : null}

      {grouped.redeemable.length > 0 ? (
        <BenefitGroup
          title="Ready to claim"
          benefits={grouped.redeemable}
          redeemingId={redeemingId}
          onRedeem={onRedeem}
        />
      ) : null}

      {grouped.redeemed.length > 0 ? (
        <BenefitGroup
          title="Claimed"
          benefits={grouped.redeemed}
          redeemingId={redeemingId}
          onRedeem={onRedeem}
        />
      ) : null}

      {[...grouped.unavailable, ...grouped.locked].length > 0 ? (
        <BenefitGroup
          title="Not currently claimable"
          benefits={[...grouped.unavailable, ...grouped.locked]}
          redeemingId={redeemingId}
          onRedeem={onRedeem}
        />
      ) : null}
    </div>
  );
}

function BenefitGroup({
  title,
  benefits,
  redeemingId,
  onRedeem,
}: {
  title: string;
  benefits: CommunityBenefit[];
  redeemingId: string | null;
  onRedeem: (benefit: CommunityBenefit) => void;
}) {
  return (
    <section className="community-benefits__group" aria-label={title}>
      <h3>{title}</h3>
      <div className="community-benefits__grid">
        {benefits.map((benefit) => (
          <BenefitCard
            key={benefit.id}
            benefit={benefit}
            busy={redeemingId === benefit.id}
            onRedeem={onRedeem}
          />
        ))}
      </div>
    </section>
  );
}

function BenefitCard({
  benefit,
  busy,
  onRedeem,
}: {
  benefit: CommunityBenefit;
  busy: boolean;
  onRedeem: (benefit: CommunityBenefit) => void;
}) {
  const state = communityBenefitState(benefit);
  const status = communityBenefitStatusCopy(benefit);

  return (
    <article className={`community-benefit-card community-benefit-card--${state}`}>
      <div className="community-benefit-card__topline">
        <span className={`community-benefit-card__status community-benefit-card__status--${state}`}>
          {status.label}
        </span>
        <span>{communityBenefitTypeLabel(benefit.benefitType)}</span>
      </div>
      <div>
        <h4>{benefit.title}</h4>
        {benefit.description ? <p>{benefit.description}</p> : null}
      </div>
      <p className="community-benefit-card__state-copy">{status.body}</p>
      {benefit.artistId ? (
        <small className="community-benefit-card__artist">Artist benefit</small>
      ) : (
        <small className="community-benefit-card__artist">Community-wide benefit</small>
      )}
      <div className="community-benefit-card__actions">
        {state === "redeemable" ? (
          <Button onClick={() => onRedeem(benefit)} disabled={busy}>
            {busy ? "Claiming..." : "Claim benefit"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
