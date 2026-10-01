"use client";

import type {
  AgentQualityDashboard,
  DiscoverySurfaceRow,
  DiscoveryVariantComparison,
  DiscoveryVariantExposure,
  ResonantDiscoveriesSummary,
} from "../../../lib/api";

/**
 * Discovery quality sections for the operator page (#1455 WS-8, rendered in
 * #2005): resonant discoveries, per-surface rates and the ranker variant
 * comparison. Aggregate and pseudonymous: counts, rates and labels only.
 *
 * Each section degrades on its own: an absent (older backend) or `unavailable`
 * section says so, a section without rows says there is no data, and capped
 * reads say the numbers may be incomplete.
 */

/** The API caps surface, variant and comparison rows at this many. */
export const DISCOVERY_ROW_LIMIT = 100;

type Props = {
  data: Pick<
    AgentQualityDashboard,
    "surfaceBreakdown" | "variantExposure" | "comparison" | "resonantDiscoveries"
  >;
};

export default function DiscoveryQualitySections({ data }: Props) {
  return (
    <section aria-label="Discovery quality" className="analytics-container">
      <header>
        <p className="artist-analytics-eyebrow" style={{ fontSize: "12px", opacity: 0.5, margin: "0 0 4px" }}>
          Discovery Quality
        </p>
        <h2 style={{ margin: 0 }}>Surfaces, Variants And Resonant Discoveries</h2>
      </header>
      <ResonantDiscoveries summary={data.resonantDiscoveries} />
      <SurfaceTable rows={data.surfaceBreakdown} />
      <VariantComparison comparison={data.comparison} exposure={data.variantExposure} />
    </section>
  );
}

function ResonantDiscoveries({ summary }: { summary?: ResonantDiscoveriesSummary }) {
  return (
    <div className="premium-table-wrapper" data-testid="resonant-discoveries">
      <div className="chart-card-header">
        <h2>Resonant Discoveries</h2>
        {summary && summary.status !== "unavailable" ? (
          <div className="chart-card-header-badge">{formatNumber(summary.activeListeners)} active listeners</div>
        ) : null}
      </div>
      {!summary || summary.status === "unavailable" ? (
        <p className="analytics-muted">Resonant discovery counts are unavailable right now.</p>
      ) : summary.status === "no_data" ? (
        <p className="analytics-muted">No active listeners in this window, so there are no resonant discoveries to count.</p>
      ) : (
        <>
          <section className="kpi-row" aria-label="Resonant discovery counts">
            <Kpi label="Discoveries" value={formatNumber(summary.total)} detail="played to 90%+, then replayed or saved" />
            <Kpi label="New artists" value={formatNumber(summary.distinctNewArtists)} detail="distinct artists discovered" />
            <Kpi label="Per listener" value={summary.perActiveListener.toFixed(2)} detail="per active listener" />
          </section>
          {summary.status === "truncated" ? (
            <p className="analytics-muted" role="status">
              Truncated: the read hit its cap, so these counts may be lower than the true totals.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

const SURFACE_COLUMNS = "minmax(140px, 1.4fr) repeat(6, minmax(64px, 0.65fr))";

function SurfaceTable({ rows }: { rows?: DiscoverySurfaceRow[] }) {
  return (
    <div className="premium-table-wrapper" data-testid="surface-breakdown">
      <div className="chart-card-header">
        <h2>Surface Outcomes</h2>
        {rows ? <div className="chart-card-header-badge">{rows.length} surfaces</div> : null}
      </div>
      {!rows ? (
        <p className="analytics-muted">Per-surface discovery quality is unavailable from this backend.</p>
      ) : rows.length === 0 ? (
        <p className="analytics-muted">No discovery-surface events in this window.</p>
      ) : (
        <>
          <div className="analytics-quality-table" role="table" aria-label="Per-surface discovery rates">
            <div
              className="analytics-quality-row analytics-quality-row--head"
              role="row"
              style={{ gridTemplateColumns: SURFACE_COLUMNS }}
            >
              <span>Surface</span>
              <span>Impr.</span>
              <span>Plays</span>
              <span>Click</span>
              <span>Skip</span>
              <span>Save</span>
              <span>Complete</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.surface}
                className="analytics-quality-row"
                role="row"
                style={{ gridTemplateColumns: SURFACE_COLUMNS }}
              >
                <span>{surfaceLabel(row.surface)}</span>
                <strong>{formatNumber(row.impressions)}</strong>
                <strong>{formatNumber(row.plays)}</strong>
                <strong>{row.surface === "dj" ? "n/a" : formatPercent(row.clickThroughRate)}</strong>
                <strong>{formatPercent(row.skipRate)}</strong>
                <strong>{formatPercent(row.saveRate)}</strong>
                <strong>{formatPercent(row.completionRate)}</strong>
              </div>
            ))}
          </div>
          <p className="analytics-muted" style={{ marginTop: "12px" }}>
            Click rate is clicks per impression. Skip, save and complete rates are per play. The AI DJ has no
            click, so its click rate is not applicable.
          </p>
          {rows.length >= DISCOVERY_ROW_LIMIT ? (
            <p className="analytics-muted" role="status">
              Truncated: showing the first {DISCOVERY_ROW_LIMIT} surfaces; some rows may be omitted.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

const COMPARISON_COLUMNS = "minmax(150px, 1.4fr) repeat(6, minmax(64px, 0.65fr))";

function VariantComparison({
  comparison,
  exposure,
}: {
  comparison?: { baselineVariant: string; note: string; rows: DiscoveryVariantComparison[] };
  exposure?: DiscoveryVariantExposure[];
}) {
  const rows = comparison?.rows;
  return (
    <div className="premium-table-wrapper" data-testid="variant-comparison">
      <div className="chart-card-header">
        <h2>Ranker Variant Comparison</h2>
        {rows ? <div className="chart-card-header-badge">{rows.length} comparisons</div> : null}
      </div>
      {!comparison || !rows ? (
        <p className="analytics-muted">Variant comparison is unavailable from this backend.</p>
      ) : rows.length === 0 ? (
        <p className="analytics-muted">
          No variant comparison yet. It needs a {comparison.baselineVariant} group and at least one other variant
          with data on the same surface.
        </p>
      ) : (
        <>
          <div className="analytics-quality-table" role="table" aria-label="Ranker variant comparison">
            <div
              className="analytics-quality-row analytics-quality-row--head"
              role="row"
              style={{ gridTemplateColumns: COMPARISON_COLUMNS }}
            >
              <span>Surface / variant</span>
              <span>Exposures</span>
              <span>Sample (n)</span>
              <span>Click</span>
              <span>Skip</span>
              <span>Complete</span>
              <span>Save</span>
            </div>
            {rows.map((row) => (
              <div
                key={`${row.experimentKey ?? "none"}|${row.surface}|${row.variant}`}
                className="analytics-quality-row"
                role="row"
                style={{ gridTemplateColumns: COMPARISON_COLUMNS }}
              >
                <span>
                  {surfaceLabel(row.surface)} · {row.variant}
                  {row.experimentKey ? ` (${row.experimentKey})` : ""}
                </span>
                <strong>{formatNumber(exposureFor(exposure, row))}</strong>
                <strong title={`${row.baselineVariant}: ${formatNumber(row.sampleSize.baselineImpressions)} impressions, ${formatNumber(row.sampleSize.baselinePlays)} plays`}>
                  {formatNumber(row.sampleSize.variantImpressions)} / {formatNumber(row.sampleSize.variantPlays)}
                </strong>
                <strong>{row.surface === "dj" ? "n/a" : formatDelta(row.deltas.clickThroughRate)}</strong>
                <strong>{formatDelta(row.deltas.skipRate)}</strong>
                <strong>{formatDelta(row.deltas.completionRate)}</strong>
                <strong>{formatDelta(row.deltas.saveRate)}</strong>
              </div>
            ))}
          </div>
          <p className="analytics-muted" style={{ marginTop: "12px" }}>
            Sample is impressions / plays for the variant. Deltas are variant minus {comparison.baselineVariant}, in
            percentage points. Exposures are ranker generations for that listener group. {comparison.note}
          </p>
          {rows.length >= DISCOVERY_ROW_LIMIT ? (
            <p className="analytics-muted" role="status">
              Truncated: showing the first {DISCOVERY_ROW_LIMIT} comparisons; some rows may be omitted.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Exposure rows are per `home` / `dj`; comparison rows are per Home rail or `dj`. */
function exposureFor(exposure: DiscoveryVariantExposure[] | undefined, row: DiscoveryVariantComparison) {
  const exposureSurface = row.surface === "dj" ? "dj" : "home";
  return (exposure ?? [])
    .filter(
      (item) =>
        item.surface === exposureSurface &&
        item.variant === row.variant &&
        item.experimentKey === row.experimentKey,
    )
    .reduce((total, item) => total + item.generations, 0);
}

function surfaceLabel(surface: string) {
  if (surface === "dj") return "AI DJ";
  if (surface.startsWith("home:")) return `Home · ${surface.slice("home:".length)}`;
  return surface;
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="premium-kpi-card agent-context">
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        <div className="kpi-icon-glow">{label.slice(0, 1)}</div>
      </div>
      <div className="kpi-value-mono">{value}</div>
      <div className="kpi-subtitle-trend">
        <span>{detail}</span>
      </div>
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(value: number) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pp`;
}
