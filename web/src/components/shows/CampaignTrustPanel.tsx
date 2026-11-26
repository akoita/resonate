import {
  campaignTrustState,
  campaignTerms,
  campaignFeeNotice,
  campaignDisputeView,
  refundDisclosure,
  type Campaign,
} from "../../lib/shows";
import { CampaignTrustBadge } from "./CampaignTrustBadge";

interface Props {
  campaign: Campaign;
}

function humanizeAuthority(status: string): string {
  switch (status) {
    case "artist_authorized":
      return "Approved by the artist";
    case "trusted_source_authorized":
      return "Approved by the artist's team";
    case "artist_acknowledged":
      return "Seen by the artist";
    case "human_verified":
      return "Checked by Resonate";
    case "rejected":
      return "Declined";
    case "revoked":
      return "Withdrawn";
    case "expired":
      return "Expired";
    case "none":
      return "Not reviewed yet";
    default:
      return status.replaceAll("_", " ");
  }
}

function humanizeBeneficiaryType(type?: string | null): string {
  switch (type) {
    case "split_contract":
      return "Split between the artist's team";
    case "multisig":
      return "An account the artist's team shares";
    default:
      return "The artist's account";
  }
}

/**
 * #949: fan-facing trust state + immutable terms + authority/beneficiary
 * summary, shown before pledge signing. Renders only non-sensitive data (the
 * public DTO already withholds authority evidence/credential ids); the
 * beneficiary address is public on-chain data and is masked for display.
 */
export function CampaignTrustPanel({ campaign }: Props) {
  const trust = campaignTrustState(campaign);
  const terms = campaignTerms(campaign);
  const feeNotice = campaignFeeNotice(campaign);
  const refundNotice = refundDisclosure(campaign);
  const dispute = campaignDisputeView(campaign);
  // Only surface the dispute row when there's something to say: an active or
  // resolved dispute, or an open post-fulfillment dispute window.
  const showDispute = dispute.status !== "none" || dispute.windowOpen;
  // A term the campaign has not set yet reads as missing, not as a dash.
  const knownTerms = terms.filter((term) => term.value && term.value !== "—");

  return (
    <section
      className="campaign-trust"
      aria-label="Campaign trust and terms"
      data-trust={trust.key}
    >
      <div className="campaign-trust__header">
        <CampaignTrustBadge campaign={campaign} />
        <p className="campaign-trust__description">{trust.description}</p>
      </div>

      <div className="campaign-trust__authority">
        <span className="campaign-trust__authority-label">Artist approval</span>
        <span className="campaign-trust__authority-value">
          {humanizeAuthority(campaign.artistAuthorityStatus)}
        </span>
        {campaign.beneficiaryAddress ? (
          <>
            <span className="campaign-trust__authority-label">Paid out to</span>
            {/* Who receives the money, in words. The address itself is on the
                public ledger the funding card links to. */}
            <span className="campaign-trust__authority-value">
              {humanizeBeneficiaryType(campaign.beneficiaryType)}
            </span>
          </>
        ) : null}
      </div>

      <div className="campaign-trust__terms">
        <h3 className="campaign-trust__terms-title">Campaign terms</h3>
        <dl className="campaign-trust__terms-grid">
          {knownTerms.map((term) => (
            <div className="campaign-trust__term" key={term.label}>
              <dt>{term.label}</dt>
              <dd className="tabular">{term.value}</dd>
            </div>
          ))}
        </dl>
        <p className="campaign-trust__terms-note">
          A pledge shows the artist there is real demand; it does not guarantee a
          ticket. The money is only paid out once the show is booked and played,
          under the terms above.
        </p>
        {feeNotice ? (
          <p className="campaign-trust__fee-note">{feeNotice}</p>
        ) : null}
        {refundNotice ? (
          <p className="campaign-trust__refund-note">{refundNotice}</p>
        ) : null}
      </div>

      {showDispute ? (
        <div className="campaign-trust__dispute" data-dispute={dispute.status}>
          <span className={`campaign-trust-badge campaign-trust-badge--${dispute.tone}`}>
            {dispute.label}
          </span>
          <p className="campaign-trust__dispute-note">
            {dispute.status === "active"
              ? "A dispute is under operator review. Final release is paused until it resolves."
              : dispute.windowClosesAt
                ? `Backers can raise a dispute until ${dispute.windowClosesAt}; funds are released only after this window closes.`
                : "The dispute window for this campaign has closed."}
          </p>
        </div>
      ) : null}
    </section>
  );
}
