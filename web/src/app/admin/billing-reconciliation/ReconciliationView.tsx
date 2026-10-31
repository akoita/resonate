"use client";

import type { ReactNode } from "react";
import { Button } from "../../../components/ui/Button";
import {
  AlertIcon,
  CheckIcon,
  RefreshIcon,
  ReviewNotice,
  ReviewQueueHeader,
  ReviewQueueLoading,
  ReviewQueuePage,
  ReviewQueueStatePanel,
} from "../../../components/admin/review-queue/ReviewQueue";
import type {
  BillingCurrencyControlTotals,
  BillingInvoiceRow,
  BillingPurchaseRow,
  BillingReconciliationReport,
  BillingReconciliationSection,
  BillingRefundRow,
} from "../../../lib/api";
import {
  SECTION_LABELS,
  formatCreditCents,
  formatMonthLabel,
  formatMoneyMinor,
  formatUtcDate,
  formatUtcTimestamp,
  humanizeCode,
  shortenReference,
  type ReconciliationMonthOption,
} from "./reconciliation";

/** #2497: the operator's monthly billing reconciliation report. */

export type ReconciliationState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: BillingReconciliationReport; refreshing?: boolean };

export type ReconciliationDownloading = BillingReconciliationSection | "json";

export type ReconciliationViewProps = {
  allowed: boolean;
  month: string;
  monthOptions: ReconciliationMonthOption[];
  state: ReconciliationState;
  /** The download in flight, if any: the section, or `json` for the whole report. */
  downloading: ReconciliationDownloading | null;
  downloadError: string | null;
  onMonthChange: (month: string) => void;
  onRefresh: () => void;
  onDownloadCsv: (section: BillingReconciliationSection) => void;
  onDownloadJson: () => void;
};

const MONTH_SELECT_ID = "billing-reconciliation-month";

const selectClass =
  "min-h-[44px] min-w-[220px] rounded-[10px] border border-[var(--r-outline)] bg-[var(--r-surface-lowest)] px-3 py-2 text-[var(--r-on-surface)] focus-visible:border-[var(--r-primary-soft)]";

/** A roll-forward movement: inflows read "+", outflows "−", so opening ± movements = closing. */
const inflow = (cents: number) => `+${formatCreditCents(cents)}`;
const outflow = (cents: number) => `−${formatCreditCents(cents)}`;

function Chip({ tone, children }: { tone: "ok" | "warn" | "neutral"; children: ReactNode }) {
  const toneClass =
    tone === "ok"
      ? "border-[rgba(52,211,153,0.45)] bg-[rgba(52,211,153,0.12)] text-[var(--r-success)]"
      : tone === "warn"
        ? "border-[rgba(251,191,36,0.55)] bg-[rgba(251,191,36,0.14)] text-[var(--r-warning)]"
        : "bg-[var(--r-surface-highest)] text-[var(--r-on-surface-variant)]";
  return (
    <span className={`review-queue-pill ${toneClass}`}>
      {tone === "ok" ? <CheckIcon size={14} /> : tone === "warn" ? <AlertIcon size={14} /> : null}
      <span className={tone === "neutral" ? "" : "ml-1.5"}>{children}</span>
    </span>
  );
}

function DownloadCsvButton({
  section,
  downloading,
  onDownloadCsv,
}: {
  section: BillingReconciliationSection;
  downloading: ReconciliationDownloading | null;
  onDownloadCsv: (section: BillingReconciliationSection) => void;
}) {
  return (
    <Button
      variant="ghost"
      className="min-h-[40px] shrink-0"
      aria-label={`Download ${SECTION_LABELS[section]} as CSV`}
      disabled={downloading !== null}
      onClick={() => onDownloadCsv(section)}
    >
      {downloading === section ? "Downloading…" : "Download CSV"}
    </Button>
  );
}

function SectionCard({
  section,
  subtitle,
  badge,
  downloading,
  onDownloadCsv,
  children,
}: {
  section: BillingReconciliationSection;
  subtitle: string;
  badge?: ReactNode;
  downloading: ReconciliationDownloading | null;
  onDownloadCsv: (section: BillingReconciliationSection) => void;
  children: ReactNode;
}) {
  const headingId = `billing-reconciliation-${section}`;
  return (
    <section className="review-queue-card grid min-w-0 content-start gap-4 p-5" aria-labelledby={headingId} data-section={section}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId}>{SECTION_LABELS[section]}</h2>
            {badge}
          </div>
          <p className="analytics-muted m-0 mt-1 text-[13px]">{subtitle}</p>
        </div>
        <DownloadCsvButton section={section} downloading={downloading} onDownloadCsv={onDownloadCsv} />
      </header>
      {children}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="m-0 grid gap-0">{children}</dl>;
}

function Row({
  label,
  value,
  note,
  strong = false,
  indent = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-[var(--r-outline)] py-2 ${
        indent ? "pl-4 text-[13px] text-[var(--r-on-surface-muted)]" : ""
      } ${strong ? "font-semibold" : ""}`}
    >
      <dt className="m-0">
        {label}
        {note ? <span className="ml-2 text-[12px] font-normal text-[var(--r-on-surface-muted)]">{note}</span> : null}
      </dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </div>
  );
}

type Column<T> = {
  header: string;
  align?: "right";
  render: (row: T) => ReactNode;
};

function Reference({ value }: { value: string | null }) {
  if (!value) return <span>—</span>;
  return (
    <span className="review-queue-mono" title={value}>
      {shortenReference(value)}
    </span>
  );
}

function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  emptyText,
}: {
  label: string;
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="review-queue-text review-queue-text--muted m-0">{emptyText}</p>;
  }
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[13px]" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                scope="col"
                className={`whitespace-nowrap border-b border-[var(--r-outline)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--r-on-surface-muted)] ${
                  column.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={`border-b border-[var(--r-outline)] px-3 py-2 align-top ${
                    column.align === "right" ? "text-right tabular-nums" : "text-left"
                  }`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function money(minor: number | null, currency: string) {
  return minor === null ? "—" : formatMoneyMinor(minor, currency);
}

const PURCHASE_COLUMNS: Array<Column<BillingPurchaseRow>> = [
  { header: "Paid (UTC)", render: (row) => <span className="whitespace-nowrap">{formatUtcTimestamp(row.paidAt)}</span> },
  { header: "Account", render: (row) => <Reference value={row.accountId} /> },
  { header: "Checkout session", render: (row) => <Reference value={row.stripeCheckoutSessionId} /> },
  { header: "Pack", render: (row) => row.packId },
  { header: "Price", align: "right", render: (row) => money(row.priceCents, row.currency) },
  { header: "Charged", align: "right", render: (row) => money(row.amountTotalCents, row.currency) },
  { header: "Credits", align: "right", render: (row) => formatCreditCents(row.creditsCents) },
  { header: "Delivery", render: (row) => humanizeCode(row.delivery) },
  { header: "Credited in month", align: "right", render: (row) => formatCreditCents(row.creditedInMonthCents) },
  { header: "Status now", render: (row) => humanizeCode(row.currentStatus) },
];

const REFUND_COLUMNS: Array<Column<BillingRefundRow>> = [
  { header: "Refunded (UTC)", render: (row) => <span className="whitespace-nowrap">{formatUtcTimestamp(row.refundedAt)}</span> },
  { header: "Refund", render: (row) => <Reference value={row.refundId} /> },
  { header: "Purchase", render: (row) => <Reference value={row.creditTopUpId} /> },
  { header: "Account", render: (row) => <Reference value={row.accountId} /> },
  { header: "Refunded", align: "right", render: (row) => money(row.amountCents, row.currency) },
  { header: "Credits withdrawn", align: "right", render: (row) => formatCreditCents(row.withdrawnCreditsCents) },
  { header: "Reversed", align: "right", render: (row) => formatCreditCents(row.reversedCents) },
  { header: "Spent, not reversed", align: "right", render: (row) => formatCreditCents(row.spentNotReversedCents) },
  { header: "Held reduction", align: "right", render: (row) => formatCreditCents(row.heldReductionCents) },
  {
    header: "Status before",
    render: (row) => (
      <>
        {humanizeCode(row.statusBefore)}
        {row.backfilled ? <span className="ml-2 text-[12px] text-[var(--r-on-surface-muted)]">backfilled</span> : null}
      </>
    ),
  },
];

const NEEDS_REVIEW_COLUMNS: Array<Column<BillingPurchaseRow>> = PURCHASE_COLUMNS.filter(
  (column) => column.header !== "Credited in month",
);

const INVOICE_COLUMNS: Array<Column<BillingInvoiceRow>> = [
  { header: "Paid (UTC)", render: (row) => <span className="whitespace-nowrap">{formatUtcTimestamp(row.paidAt)}</span> },
  { header: "Invoice", render: (row) => <Reference value={row.stripeInvoiceId} /> },
  { header: "Account", render: (row) => <Reference value={row.accountId} /> },
  { header: "Subscription", render: (row) => <Reference value={row.stripeSubscriptionId} /> },
  { header: "Amount paid", align: "right", render: (row) => money(row.amountPaidCents, row.currency) },
  { header: "Excluding tax", align: "right", render: (row) => money(row.amountExcludingTaxCents, row.currency) },
  { header: "Reason", render: (row) => humanizeCode(row.billingReason) },
  { header: "Interval", render: (row) => row.interval },
  {
    header: "Service period",
    render: (row) => (
      <span className="whitespace-nowrap">{`${formatUtcDate(row.periodStart)} to ${formatUtcDate(row.periodEnd)}`}</span>
    ),
  },
];

function ControlTotalsCard({ totals }: { totals: BillingCurrencyControlTotals }) {
  const { currency } = totals;
  const unknown = (count: number) =>
    count > 0 ? `${count} without a recorded charge amount` : undefined;
  return (
    <div
      className="min-w-0 rounded-[10px] border border-[var(--r-outline)] bg-[var(--r-surface-lowest)] p-4"
      data-currency={currency}
    >
      <h3 className="uppercase tracking-[0.06em]" style={{ margin: "0 0 8px", fontSize: 13 }}>
        {currency.toUpperCase()}
      </h3>
      <Rows>
        <Row
          label="Credit pack purchases"
          note={`${totals.creditPackPurchases.count}`}
          value={formatMoneyMinor(totals.creditPackPurchases.chargedCents, currency)}
        />
        {unknown(totals.creditPackPurchases.chargedUnknownCount) ? (
          <Row indent label={unknown(totals.creditPackPurchases.chargedUnknownCount)!} value="" />
        ) : null}
        <Row
          label="Credit pack refunds"
          note={`${totals.creditPackRefunds.count}`}
          value={formatMoneyMinor(totals.creditPackRefunds.amountCents, currency)}
        />
        <Row
          label="Needs review"
          note={`${totals.needsReview.count}`}
          value={formatMoneyMinor(totals.needsReview.chargedCents, currency)}
        />
        {unknown(totals.needsReview.chargedUnknownCount) ? (
          <Row indent label={unknown(totals.needsReview.chargedUnknownCount)!} value="" />
        ) : null}
        <Row
          label="Subscription invoices"
          note={`${totals.subscriptionInvoices.count}`}
          value={formatMoneyMinor(totals.subscriptionInvoices.amountPaidCents, currency)}
        />
        <Row strong label="Net collected" value={formatMoneyMinor(totals.netCollectedCents, currency)} />
      </Rows>
    </div>
  );
}

function RollForwardCheck({ balanced, closing, computed }: { balanced: boolean; closing: number; computed: number }) {
  return (
    <>
      <Row label="Closing balance" strong value={formatCreditCents(closing)} />
      <Row
        label="Closing recomputed from the movements"
        value={
          <span className="inline-flex items-center gap-2">
            {formatCreditCents(computed)}
            <Chip tone={balanced ? "ok" : "warn"}>{balanced ? "Balanced" : "Does not balance"}</Chip>
          </span>
        }
      />
    </>
  );
}

function ReportBody({
  report,
  downloading,
  onDownloadCsv,
}: {
  report: BillingReconciliationReport;
  downloading: ReconciliationDownloading | null;
  onDownloadCsv: (section: BillingReconciliationSection) => void;
}) {
  const held = report.heldPurchases;
  const balance = report.creditBalance;
  const allowance = report.allowance;
  const section = { downloading, onDownloadCsv };
  return (
    <>
      <SectionCard
        section="control_totals"
        subtitle="Per currency. Tie these out against the Stripe balance report for the same month."
        {...section}
      >
        {report.controlTotals.length === 0 ? (
          <p className="review-queue-text review-queue-text--muted m-0">
            No payments, refunds or invoices in this month.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
            {report.controlTotals.map((totals) => (
              <ControlTotalsCard key={totals.currency} totals={totals} />
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <SectionCard
          section="held_purchases"
          subtitle="Credit packs paid but not yet credited: opening, movements, closing."
          {...section}
        >
          <Rows>
            <Row label="Opening" value={formatCreditCents(held.openingCents)} />
            <Row label="Purchased" value={inflow(held.purchasedCents)} />
            <Row label="Credited to the balance" value={outflow(held.creditedCents)} />
            <Row label="Withdrawn by refunds" value={outflow(held.refundWithdrawnCents)} />
            <RollForwardCheck balanced={held.balanced} closing={held.closingCents} computed={held.computedClosingCents} />
          </Rows>
        </SectionCard>

        <SectionCard
          section="credit_balance"
          subtitle="Bought and free credits share one pooled balance: opening, movements, closing."
          {...section}
        >
          <Rows>
            <Row label="Opening" value={formatCreditCents(balance.openingCents)} />
            <Row label="Grants" value={inflow(balance.topUpGrantsCents + balance.freeGrantsCents)} />
            {balance.grants.map((grant) => (
              <Row
                key={grant.label}
                indent
                label={humanizeCode(grant.label)}
                note={`${grant.count}`}
                value={formatCreditCents(grant.cents)}
              />
            ))}
            <Row indent label="Bought (top-ups)" value={formatCreditCents(balance.topUpGrantsCents)} />
            <Row indent label="Free" value={formatCreditCents(balance.freeGrantsCents)} />
            <Row label="Spends" note={`${balance.spends.count}`} value={outflow(balance.spends.cents)} />
            {balance.spendsByReason.map((spend) => (
              <Row
                key={spend.label}
                indent
                label={humanizeCode(spend.label)}
                note={`${spend.count}`}
                value={formatCreditCents(spend.cents)}
              />
            ))}
            <Row label="Job refunds" note={`${balance.jobRefunds.count}`} value={inflow(balance.jobRefunds.cents)} />
            {balance.jobRefundsByReason.map((refund) => (
              <Row
                key={refund.label}
                indent
                label={humanizeCode(refund.label)}
                note={`${refund.count}`}
                value={formatCreditCents(refund.cents)}
              />
            ))}
            <Row
              label="Credit pack refund reversals"
              note={`${balance.topUpRefundReversals.count}`}
              value={outflow(balance.topUpRefundReversals.cents)}
            />
            {balance.unclassified.count > 0 ? (
              <Row label="Unclassified entries" value={`${balance.unclassified.count}`} />
            ) : null}
            <RollForwardCheck balanced={balance.balanced} closing={balance.closingCents} computed={balance.computedClosingCents} />
          </Rows>
        </SectionCard>
      </div>

      <SectionCard
        section="allowance"
        subtitle={allowance.note || "The monthly credit allowance that comes with Artist Pro."}
        badge={<Chip tone="neutral">Not a liability</Chip>}
        {...section}
      >
        <Rows>
          <Row label="Granted" note={`${allowance.grantedCount}`} value={formatCreditCents(allowance.grantedCents)} />
          <Row label="Used" value={formatCreditCents(allowance.usedCents)} />
          <Row label="Returned" value={formatCreditCents(allowance.returnedCents)} />
          <Row label="Lapsed" value={formatCreditCents(allowance.lapsedCents)} />
        </Rows>
      </SectionCard>

      <SectionCard
        section="purchases"
        subtitle="Credit packs paid in the month and credited, or held and credited later."
        badge={<Chip tone="neutral">{`${report.creditPacks.purchases.length}`}</Chip>}
        {...section}
      >
        <DataTable
          label="Credit pack purchases"
          columns={PURCHASE_COLUMNS}
          rows={report.creditPacks.purchases}
          rowKey={(row) => row.creditTopUpId}
          emptyText="No credit packs were bought in this month."
        />
      </SectionCard>

      <SectionCard
        section="refunds"
        subtitle="Credit pack refunds applied in the month and what happened to the credits."
        badge={<Chip tone="neutral">{`${report.creditPacks.refunds.length}`}</Chip>}
        {...section}
      >
        <DataTable
          label="Credit pack refunds"
          columns={REFUND_COLUMNS}
          rows={report.creditPacks.refunds}
          rowKey={(row) => row.refundId}
          emptyText="No credit packs were refunded in this month."
        />
      </SectionCard>

      <SectionCard
        section="needs_review"
        subtitle="Credit packs paid in the month that were never credited. Each one needs a decision."
        badge={
          <Chip tone={report.creditPacks.needsReview.length > 0 ? "warn" : "neutral"}>
            {`${report.creditPacks.needsReview.length}`}
          </Chip>
        }
        {...section}
      >
        <DataTable
          label="Credit packs that need review"
          columns={NEEDS_REVIEW_COLUMNS}
          rows={report.creditPacks.needsReview}
          rowKey={(row) => row.creditTopUpId}
          emptyText="Nothing needs review: every credit pack paid in this month was credited."
        />
      </SectionCard>

      <SectionCard
        section="subscription_invoices"
        subtitle="Artist Pro invoices paid in the month, with the period each one covers."
        badge={<Chip tone="neutral">{`${report.subscriptionInvoices.length}`}</Chip>}
        {...section}
      >
        <DataTable
          label="Subscription invoices"
          columns={INVOICE_COLUMNS}
          rows={report.subscriptionInvoices}
          rowKey={(row) => row.stripeInvoiceId}
          emptyText="No Artist Pro invoices were paid in this month."
        />
      </SectionCard>
    </>
  );
}

function StatusSummary({ report }: { report: BillingReconciliationReport }) {
  const needsReviewCount = report.creditPacks.needsReview.length;
  const { heldPurchases: held, creditBalance: balance, integrity } = report;
  return (
    <section className="grid gap-3" aria-label="Checks for this month">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={held.balanced ? "ok" : "warn"}>
          {held.balanced ? "Held purchases balance" : "Held purchases do not balance"}
        </Chip>
        <Chip tone={balance.balanced ? "ok" : "warn"}>
          {balance.balanced ? "Credit balance balances" : "Credit balance does not balance"}
        </Chip>
        <Chip tone={integrity.matches ? "ok" : "warn"}>
          {integrity.matches ? "Ledger matches account balances" : "Ledger and account balances differ"}
        </Chip>
        <Chip tone={needsReviewCount > 0 ? "warn" : "ok"}>
          {needsReviewCount > 0 ? `${needsReviewCount} need review` : "Nothing needs review"}
        </Chip>
        {!report.complete ? <Chip tone="warn">In progress</Chip> : <Chip tone="neutral">Month closed</Chip>}
      </div>

      {!report.complete ? (
        <ReviewNotice tone="info">
          {`${formatMonthLabel(report.month)} is still in progress, so its totals can still change. Run the report again after the month ends.`}
        </ReviewNotice>
      ) : null}
      {!integrity.matches ? (
        <ReviewNotice tone="warning">
          {`The credit ledger (${formatCreditCents(integrity.ledgerBalanceNowCents)}) and the account balances (${formatCreditCents(integrity.accountsBalanceNowCents)}) do not match today. Do not rely on the credit balance figures until the difference is explained.`}
        </ReviewNotice>
      ) : null}
      {!held.balanced ? (
        <ReviewNotice tone="warning">
          {`The held purchases do not balance: the closing balance is ${formatCreditCents(held.closingCents)} but the movements add up to ${formatCreditCents(held.computedClosingCents)}.`}
        </ReviewNotice>
      ) : null}
      {!balance.balanced ? (
        <ReviewNotice tone="warning">
          {`The credit balance does not balance: the closing balance is ${formatCreditCents(balance.closingCents)} but the movements add up to ${formatCreditCents(balance.computedClosingCents)}.`}
        </ReviewNotice>
      ) : null}
      {balance.unclassified.count > 0 ? (
        <ReviewNotice tone="warning">
          {`${balance.unclassified.count} credit ledger ${balance.unclassified.count === 1 ? "entry was" : "entries were"} not recognised, so the movements above may be incomplete.`}
        </ReviewNotice>
      ) : null}
      {needsReviewCount > 0 ? (
        <ReviewNotice tone="warning">
          {`${needsReviewCount} credit pack ${needsReviewCount === 1 ? "payment was" : "payments were"} taken but never credited. Review ${needsReviewCount === 1 ? "it" : "them"} before you close the month.`}
        </ReviewNotice>
      ) : null}
    </section>
  );
}

export default function ReconciliationView({
  allowed,
  month,
  monthOptions,
  state,
  downloading,
  downloadError,
  onMonthChange,
  onRefresh,
  onDownloadCsv,
  onDownloadJson,
}: ReconciliationViewProps) {
  const refreshing = state.status === "ready" && Boolean(state.refreshing);
  const busy = state.status === "loading" || refreshing;
  // A month outside the list (for instance from a stale link) is still shown, never silently swapped.
  const options = monthOptions.some((option) => option.value === month)
    ? monthOptions
    : [{ value: month, label: formatMonthLabel(month), inProgress: false }, ...monthOptions];

  return (
    <ReviewQueuePage className="billing-reconciliation-admin">
      <ReviewQueueHeader
        eyebrow="Operator finance"
        title="Billing reconciliation"
        description={(
          <>
            One month of credit pack payments, refunds, the generation credit ledger and Artist Pro invoices, with control
            totals to tie out against Stripe. It holds ids, amounts and dates only, never names or email addresses.
          </>
        )}
      />

      {!allowed ? (
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Access denied"
          body="Only operators and administrators can open the billing reconciliation report."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label htmlFor={MONTH_SELECT_ID} className="text-[13px] font-semibold">Month (UTC)</label>
              <select
                id={MONTH_SELECT_ID}
                className={selectClass}
                value={month}
                onChange={(event) => onMonthChange(event.target.value)}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <Button variant="ghost" className="min-h-[44px]" disabled={busy} onClick={onRefresh}>
              <RefreshIcon size={16} />
              {busy ? "Loading…" : "Refresh"}
            </Button>
            <Button
              variant="primary"
              className="ml-auto min-h-[44px]"
              disabled={state.status !== "ready" || downloading !== null}
              onClick={onDownloadJson}
            >
              {downloading === "json" ? "Downloading…" : "Download JSON"}
            </Button>
          </div>

          <p className="analytics-muted m-0 text-[13px]" role="note">
            Opening a month or downloading a section is recorded in the audit log.
          </p>

          {downloadError ? (
            <ReviewNotice tone="warning">{downloadError}</ReviewNotice>
          ) : null}

          {state.status === "loading" ? (
            <ReviewQueueLoading statusText={`Loading the ${formatMonthLabel(month)} report…`} />
          ) : null}

          {state.status === "error" ? (
            <ReviewQueueStatePanel
              variant="error"
              heading="Unable to load the report"
              body={state.message}
              actionLabel="Try again"
              onAction={onRefresh}
            />
          ) : null}

          {state.status === "ready" ? (
            <div className={`grid min-w-0 gap-5 ${refreshing ? "opacity-60" : ""}`} aria-busy={refreshing || undefined}>
              <StatusSummary report={state.report} />
              <ReportBody report={state.report} downloading={downloading} onDownloadCsv={onDownloadCsv} />
              <p className="analytics-muted m-0 text-[12px]">
                {`Generated ${formatUtcTimestamp(state.report.generatedAt)} for ${formatMonthLabel(state.report.month)}.`}
              </p>
            </div>
          ) : null}
        </>
      )}
    </ReviewQueuePage>
  );
}
