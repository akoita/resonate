"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  CopyableValue,
  ReviewQueueHeader,
  ReviewQueuePage,
  ReviewQueueStatePanel,
} from "../../../../components/admin/review-queue/ReviewQueue";
import type { AdminAccountStatus, AdminUserDetail } from "../../../../lib/api";
import {
  adminActionLabel,
  adminActionReason,
  formatAssetAmount,
  formatDateTime,
  formatDay,
  personLabel,
  pluralize,
  reasonLabel,
  shortAddress,
  toRestrictionAccount,
} from "../../../../lib/adminUsers";
import AccountRestrictionControls from "./AccountRestrictionControls";
import { DuplicateChip, RoleChips, StatusChip } from "../UsersView";

export type UserDetailState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: AdminUserDetail };

export type UserDetailViewProps = {
  state: UserDetailState;
  /** Only admins get the suspend / close controls; operators read. */
  isAdmin: boolean;
  token: string | null;
  onStatusChanged: (updated: AdminAccountStatus) => void;
  onRetry: () => void;
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section className="admin-users-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function BackLink() {
  return (
    <Link href="/admin/users" className="admin-users-back" prefetch={false}>
      &larr; All users
    </Link>
  );
}

function Identity({ detail }: { detail: AdminUserDetail }) {
  const wallet = detail.wallet;
  return (
    <Section title="Identity" id="admin-user-identity">
      <dl className="admin-users-facts">
        <Fact label="User id">
          <CopyableValue value={detail.id} subject="user id" />
        </Fact>
        <Fact label="Wallet address">
          {wallet ? <CopyableValue value={wallet.address} subject="wallet address" /> : <span className="admin-users-muted">No wallet</span>}
        </Fact>
        <Fact label="Owner address">
          {wallet?.ownerAddress ? (
            <CopyableValue value={wallet.ownerAddress} subject="owner address" />
          ) : (
            <span className="admin-users-muted">None</span>
          )}
        </Fact>
        <Fact label="Account type">{wallet ? wallet.accountType : <span className="admin-users-muted">None</span>}</Fact>
        <Fact label="Network">{wallet ? `Chain ${wallet.chainId}` : <span className="admin-users-muted">None</span>}</Fact>
        <Fact label="Passkeys">{pluralize(detail.passkeyCount, "passkey")}</Fact>
        <Fact label="Joined">{formatDay(detail.createdAt)}</Fact>
        <Fact label="Last sign-in">{formatDay(detail.lastSignInAt)}</Fact>
        <Fact label="Last active">{formatDay(detail.lastActiveDay)}</Fact>
      </dl>
    </Section>
  );
}

function StatusSection({
  detail,
  isAdmin,
  token,
  onStatusChanged,
}: {
  detail: AdminUserDetail;
  isAdmin: boolean;
  token: string | null;
  onStatusChanged: (updated: AdminAccountStatus) => void;
}) {
  const effective = detail.status.accountStatus;
  const reason = reasonLabel(detail.status.reason);
  return (
    <Section title="Account status" id="admin-user-status">
      <dl className="admin-users-facts">
        <Fact label="Status">
          <StatusChip status={effective} />
        </Fact>
        <Fact label="Reason">{reason ?? <span className="admin-users-muted">None</span>}</Fact>
        <Fact label="Suspension ends">
          {detail.status.until ? formatDay(detail.status.until) : <span className="admin-users-muted">No end date</span>}
        </Fact>
        <Fact label="Last changed">
          {detail.status.changedAt ? formatDateTime(detail.status.changedAt) : <span className="admin-users-muted">Never</span>}
        </Fact>
      </dl>
      {isAdmin ? (
        <AccountRestrictionControls
          token={token}
          account={toRestrictionAccount(detail)}
          onChanged={onStatusChanged}
        />
      ) : (
        <p className="admin-users-readonly">
          Only admins can suspend or close an account. You can see its state here.
        </p>
      )}
    </Section>
  );
}

function ActivityList<T extends { id: string }>({
  heading,
  items,
  empty,
  render,
}: {
  heading: string;
  items: T[];
  empty: string;
  render: (item: T) => ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: "8px", alignContent: "start" }}>
      <h3>{heading}</h3>
      {items.length === 0 ? (
        <p className="admin-users-note">{empty}</p>
      ) : (
        <ul className="admin-users-list">
          {items.map((item) => (
            <li key={item.id}>{render(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Activity({ detail }: { detail: AdminUserDetail }) {
  const { activity, counts } = detail;
  return (
    <Section title="Activity" id="admin-user-activity">
      <dl className="admin-users-facts">
        <Fact label="Purchases">{counts.purchases}</Fact>
        <Fact label="Show pledges">{counts.pledges}</Fact>
        <Fact label="Releases">{counts.releases}</Fact>
        <Fact label="Notices received">{activity.noticesReceived}</Fact>
      </dl>
      <div className="admin-users-grid">
        <ActivityList
          heading="Latest purchases"
          items={activity.recentPurchases}
          empty="No purchases yet."
          render={(purchase) => (
            <>
              <span>Paid {formatAssetAmount(purchase.totalPaid, purchase.assetDecimals, purchase.assetSymbol)}</span>
              <span className="admin-users-list__meta">{formatDateTime(purchase.purchasedAt)}</span>
            </>
          )}
        />
        <ActivityList
          heading="Latest pledges"
          items={activity.recentPledges}
          empty="No pledges yet."
          render={(pledge) => (
            <>
              <Link href={`/shows/${encodeURIComponent(pledge.campaignId)}`} prefetch={false}>
                Campaign {pledge.campaignId.slice(0, 8)}
              </Link>
              <span>{formatAssetAmount(pledge.amountUnits, pledge.assetDecimals, pledge.assetSymbol)} · {pledge.status}</span>
              <span className="admin-users-list__meta">{formatDateTime(pledge.createdAt)}</span>
            </>
          )}
        />
        <ActivityList
          heading="Latest releases"
          items={activity.recentReleases}
          empty="No releases yet."
          render={(release) => (
            <>
              <Link href={`/release/${encodeURIComponent(release.id)}`} prefetch={false}>{release.title}</Link>
              <span className="admin-users-list__meta">
                {release.status} · {formatDateTime(release.createdAt)}
              </span>
            </>
          )}
        />
      </div>
    </Section>
  );
}

function AdminActions({ detail }: { detail: AdminUserDetail }) {
  return (
    <Section title="Operator activity on this record" id="admin-user-actions">
      <p className="admin-users-note">
        Opening this record and any change to the account are logged. The newest 20 entries are shown. Internal notes
        are never part of the log.
      </p>
      {detail.adminActions.length === 0 ? (
        <p className="admin-users-note">Nothing has been logged for this person yet.</p>
      ) : (
        <ul className="admin-users-list">
          {detail.adminActions.map((entry, index) => {
            const reason = adminActionReason(entry.detail);
            return (
              <li key={`${entry.createdAt}-${entry.action}-${index}`}>
                <span>
                  {adminActionLabel(entry.action)}
                  {reason ? ` (${reason})` : ""}
                </span>
                <span className="admin-users-list__meta">
                  {formatDateTime(entry.createdAt)} · by {shortAddress(entry.actorUserId)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * #2166: one person's record for an operator. Presentation only; the page owns
 * the data and the auth gate. Operators read; only admins see the controls
 * that suspend or close an account.
 */
export default function UserDetailView({ state, isAdmin, token, onStatusChanged, onRetry }: UserDetailViewProps) {
  if (state.status === "loading") {
    return (
      <ReviewQueuePage className="admin-users-page">
        <BackLink />
        <section className="admin-users-results" aria-busy="true" aria-label="User record">
          <p className="visually-hidden" role="status">Loading user record...</p>
          <div className="admin-users-skeleton" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
        </section>
      </ReviewQueuePage>
    );
  }
  if (state.status === "forbidden") {
    return (
      <ReviewQueuePage className="admin-users-page">
        <BackLink />
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Admins and operators only"
          body="Your account does not have access to user records."
        />
      </ReviewQueuePage>
    );
  }
  if (state.status === "not_found") {
    return (
      <ReviewQueuePage className="admin-users-page">
        <BackLink />
        <ReviewQueueStatePanel
          variant="empty"
          heading="User not found"
          body="There is no user with this id. They may have been erased, or the link may be wrong."
        />
      </ReviewQueuePage>
    );
  }
  if (state.status === "error") {
    return (
      <ReviewQueuePage className="admin-users-page">
        <BackLink />
        <ReviewQueueStatePanel
          variant="error"
          heading="This record could not be loaded"
          body={state.message}
          actionLabel="Try again"
          onAction={onRetry}
        />
      </ReviewQueuePage>
    );
  }

  const { detail } = state;
  const effective = detail.status.accountStatus;
  return (
    <ReviewQueuePage className="admin-users-page">
      <BackLink />
      <div className="admin-users-hero">
        <ReviewQueueHeader
          eyebrow="User"
          title={personLabel(detail)}
          description={
            detail.artistName
              ? "This person has an artist profile. Their record shows when they last used the app and what they have done."
              : "Their record shows when they last used the app and what they have done."
          }
        />
        <div className="admin-users-chips">
          <StatusChip status={effective} />
          <RoleChips roles={detail.roles} />
          {detail.possibleDuplicate ? <DuplicateChip /> : null}
        </div>
      </div>
      <Identity detail={detail} />
      <StatusSection detail={detail} isAdmin={isAdmin} token={token} onStatusChanged={onStatusChanged} />
      <Activity detail={detail} />
      <AdminActions detail={detail} />
    </ReviewQueuePage>
  );
}
