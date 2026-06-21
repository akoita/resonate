import {
  campaignTrustState,
  campaignTerms,
  maskAddress,
  type Campaign,
} from "../../lib/shows";
import { CampaignTrustBadge } from "./CampaignTrustBadge";

interface Props {
  campaign: Campaign;
}

function humanizeAuthority(status: string): string {
  switch (status) {
    case "artist_authorized":
      return "Artist authorized";
    case "trusted_source_authorized":
      return "Trusted source authorized";
    case "artist_acknowledged":
      return "Artist acknowledged";
    case "human_verified":
      return "Human verified";
    case "rejected":
      return "Rejected";
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
    case "none":
      return "Not yet reviewed";
    default:
      return status.replaceAll("_", " ");
  }
}

function humanizeBeneficiaryType(type?: string | null): string {
  switch (type) {
    case "wallet":
      return "Wallet";
    case "split_contract":
      return "Split contract";
    case "multisig":
      return "Multisig";
    default:
      return "—";
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
        <span className="campaign-trust__authority-label">Artist authority</span>
        <span className="campaign-trust__authority-value">
          {humanizeAuthority(campaign.artistAuthorityStatus)}
        </span>
        <span className="campaign-trust__authority-label">Beneficiary</span>
        <span className="campaign-trust__authority-value tabular">
          {humanizeBeneficiaryType(campaign.beneficiaryType)} · {maskAddress(campaign.beneficiaryAddress)}
        </span>
      </div>

      <div className="campaign-trust__terms">
        <h3 className="campaign-trust__terms-title">Campaign terms</h3>
        <dl className="campaign-trust__terms-grid">
          {terms.map((term) => (
            <div className="campaign-trust__term" key={term.label}>
              <dt>{term.label}</dt>
              <dd className="tabular">{term.value}</dd>
            </div>
          ))}
        </dl>
        <p className="campaign-trust__terms-note">
          Funding proves demand; it does not guarantee a ticket. Funds release only
          after booking and fulfillment under the campaign&apos;s published policy.
        </p>
      </div>
    </section>
  );
}
