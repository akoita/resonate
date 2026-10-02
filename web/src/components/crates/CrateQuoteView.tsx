import {
  formatCountdown,
  formatUsdDecimal,
  hasReceipts,
  isQuoteExpired,
  itemPriceText,
  itemSplitText,
  lineStemTypes,
  overBudgetText,
  quoteSummaryText,
  receiptRows,
  shortHash,
  stemChoices,
  stemLabel,
  tierChoices,
  titleCase,
  crateReasonText,
  type LineChoice,
} from "../../lib/crateQuote";
import type { PreflightDrop } from "../../lib/crateQuotePreflight";
import {
  NO_STANDARD_TERMS_TEXT,
  type CrateItemDto,
  type CrateLicenseType,
  type CrateQuote,
  type CrateQuoteItem,
  type CrateQuoteLine,
  type CrateStemType,
} from "../../lib/crates";
import { getExplorerTxUrl } from "../../lib/explorer";
import "../../styles/crates.css";

/** Presentational pieces of the crate quote panel (#1964): no wallet, no network. */

function domId(prefix: string, value: string): string {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function ItemRow({ item }: { item: CrateQuoteItem }) {
  const price = itemPriceText(item);
  const split = itemSplitText(item);
  const usd = item.totalUsd === null ? null : formatUsdDecimal(item.totalUsd);
  const dropped = item.status === "dropped";
  return (
    <li
      className={`crates-quote-item ${dropped ? "crates-quote-item--dropped" : ""}`}
      data-quote-line-id={item.quoteLineId}
      data-status={item.status}
    >
      <span className="crates-quote-stem">{titleCase(item.stemType)}</span>
      {dropped ? (
        <span className="crates-quote-reason">Not in this quote: {crateReasonText(item.reason)}</span>
      ) : (
        <>
          <span className="crates-quote-price">
            {price ?? "Price unknown"}
            {usd ? ` (about ${usd})` : ""}
          </span>
          {split ? (
            <span className="crates-hint">
              Artist side {split.artist} · Platform fee {split.platform}
            </span>
          ) : null}
        </>
      )}
    </li>
  );
}

export type CrateQuoteViewProps = {
  quote: CrateQuote;
  /** The crate's lines, for the tiers and stems the DJ can switch between. */
  crateItems: CrateItemDto[];
  choices: ReadonlyMap<string, LineChoice>;
  nowMs: number;
  /** True while a new quote is being priced or a purchase is running. */
  disabled?: boolean;
  onTierChange?: (trackId: string, tier: CrateLicenseType) => void;
  onStemToggle?: (trackId: string, stem: CrateStemType) => void;
};

function QuoteLine({
  line,
  crateItem,
  choice,
  disabled,
  onTierChange,
  onStemToggle,
}: {
  line: CrateQuoteLine;
  crateItem: CrateItemDto | undefined;
  choice: LineChoice | undefined;
  disabled: boolean;
  onTierChange?: CrateQuoteViewProps["onTierChange"];
  onStemToggle?: CrateQuoteViewProps["onStemToggle"];
}) {
  const tiers = tierChoices(crateItem, line.licenseType);
  const stems = stemChoices(crateItem, line);
  const selected = choice?.stemTypes ?? lineStemTypes(line);
  const tierId = domId("crate-quote-tier", line.trackId);
  const title = line.title?.trim() || "Untitled track";
  return (
    <li className="crates-quote-line" data-track-id={line.trackId}>
      <div className="crates-line-head">
        <h4 className="crates-line-title">{title}</h4>
        {line.artistName ? <span className="crates-line-artist">{line.artistName}</span> : null}
      </div>

      <div className="crates-field">
        <label htmlFor={tierId}>License for {title}</label>
        <select
          id={tierId}
          className="crates-select"
          value={choice?.licenseType ?? line.licenseType}
          disabled={disabled || tiers.length < 2}
          onChange={(event) => onTierChange?.(line.trackId, event.target.value as CrateLicenseType)}
        >
          {tiers.map((tier) => (
            <option key={tier} value={tier}>
              {titleCase(tier)}
            </option>
          ))}
        </select>
      </div>

      {line.rights.standardTerms && line.rights.grants.length > 0 ? (
        <ul className="crates-quote-grants" aria-label={`What the ${line.licenseType} license grants`}>
          {line.rights.grants.map((grant) => (
            <li key={grant}>{grant}</li>
          ))}
        </ul>
      ) : (
        <p className="crates-hint">{NO_STANDARD_TERMS_TEXT}</p>
      )}

      <fieldset className="crates-quote-stems" disabled={disabled}>
        <legend>Stems for {title}</legend>
        {stems.map((stem) => {
          const checked = selected.includes(stem);
          const onlyOne = checked && selected.length === 1;
          return (
            <label key={stem} className="crates-quote-stem-choice">
              <input
                type="checkbox"
                checked={checked}
                disabled={onlyOne}
                onChange={() => onStemToggle?.(line.trackId, stem)}
              />
              {titleCase(stem)}
            </label>
          );
        })}
      </fieldset>

      <ul className="crates-quote-items">
        {line.items.map((item) => (
          <ItemRow key={item.quoteLineId} item={item} />
        ))}
      </ul>
    </li>
  );
}

/** The quote the DJ is about to approve: stems, prices, rights, totals, expiry. */
export function CrateQuoteView({
  quote,
  crateItems,
  choices,
  nowMs,
  disabled = false,
  onTierChange,
  onStemToggle,
}: CrateQuoteViewProps) {
  const expired = isQuoteExpired(quote, nowMs);
  const budget = overBudgetText(quote);
  const byTrack = new Map(crateItems.map((item) => [item.trackId, item]));
  return (
    <div className="crates-quote" data-quote-id={quote.id}>
      <p
        className={`crates-quote-expiry ${expired ? "crates-quote-expiry--expired" : ""}`}
        data-expired={expired ? "true" : "false"}
      >
        {expired
          ? "This quote has expired. Get a new quote."
          : `Prices are good for ${formatCountdown(quote, nowMs)}`}
      </p>

      <ol className="crates-quote-lines">
        {quote.lines.map((line) => (
          <QuoteLine
            key={line.trackId}
            line={line}
            crateItem={byTrack.get(line.trackId)}
            choice={choices.get(line.trackId)}
            disabled={disabled || expired}
            onTierChange={onTierChange}
            onStemToggle={onStemToggle}
          />
        ))}
      </ol>

      <QuoteTotals quote={quote} />
      {budget ? (
        <p className="crates-error crates-quote-budget" role="status">
          {budget}
        </p>
      ) : null}
    </div>
  );
}

export function QuoteTotals({ quote }: { quote: CrateQuote }) {
  return (
    <dl className="crates-quote-totals" aria-label="Quote total">
      {quote.totals.length === 0 ? (
        <div>
          <dt>Total</dt>
          <dd>Nothing to buy</dd>
        </div>
      ) : (
        quote.totals.map((total) => (
          <div key={total.paymentToken}>
            <dt>Total in {total.symbol}</dt>
            <dd>
              {total.total} {total.symbol}
              {total.totalUsd ? ` (about ${formatUsdDecimal(total.totalUsd)})` : ""}
            </dd>
          </div>
        ))
      )}
      {quote.totals.length > 1 ? (
        <div>
          <dt>Total in USD</dt>
          <dd>{quote.totalUsd === null ? "Not known for every currency" : formatUsdDecimal(quote.totalUsd)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Stems left out of a purchase, each with its plain reason. */
export function CrateDroppedList({
  quote,
  dropped,
}: {
  quote: CrateQuote;
  dropped: readonly PreflightDrop[];
}) {
  return (
    <ul className="crates-quote-dropped" aria-label="Stems left out">
      {dropped.map((entry) => {
        const label = stemLabel(quote, entry.quoteLineId);
        return (
          <li key={entry.quoteLineId}>
            <strong>
              {label ? `${label.trackTitle}: ${titleCase(label.stemType)}` : "A stem"}
            </strong>{" "}
            <span>{crateReasonText(entry.reason)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function TransactionLink({ hash }: { hash: string }) {
  const url = getExplorerTxUrl(hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      View transaction {shortHash(hash)}
    </a>
  ) : (
    <span title={hash}>Transaction {shortHash(hash)}</span>
  );
}

const OUTCOME_TEXT = { settled: "Bought", failed: "Not bought", dropped: "Left out" } as const;

/** Per-stem receipts once a purchase was sent. */
export function CrateQuoteReceipts({ quote }: { quote: CrateQuote }) {
  if (!hasReceipts(quote) && quote.status !== "submitted") return null;
  const rows = receiptRows(quote);
  return (
    <section className="crates-quote-receipts" aria-label="Receipts" data-quote-status={quote.status}>
      <h3>Receipts</h3>
      <p>{quoteSummaryText(quote)}</p>
      {rows.length > 0 ? (
        <ul className="crates-quote-receipt-list">
          {rows.map((row) => (
            <li key={row.quoteLineId} className={`crates-quote-receipt crates-quote-receipt--${row.outcome}`}>
              <span className="crates-quote-receipt-what">
                <strong>{row.trackTitle}</strong>: {titleCase(row.stemType)}
              </span>
              <span className="crates-quote-receipt-outcome">
                {OUTCOME_TEXT[row.outcome]}
                {row.price && row.outcome === "settled" ? ` for ${row.price}` : ""}
              </span>
              {row.reason ? <span className="crates-hint">{row.reason}</span> : null}
              {row.outcome === "settled" && row.transactionHash ? (
                <TransactionLink hash={row.transactionHash} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length === 0 && quote.transactionHash ? <TransactionLink hash={quote.transactionHash} /> : null}
    </section>
  );
}
