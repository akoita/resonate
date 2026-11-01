import Link from "next/link";
import type { ReactNode } from "react";
import type { AiDisclosure } from "../../lib/api";
import type { CardQueueTarget } from "../../lib/cardQueue";
import { CardQueueButton } from "../ui/CardQueueButton";
import { AiDisclosureBadge } from "../content/AiDisclosureBadge";

/*
 * Home v3 tile — the single tile used by the personalized feed rails,
 * Trending Now, and Top Artists.
 *
 * The art stays unobstructed: only a small glass badge chip (top-left) and an
 * optional floating action circle (bottom-right) overlay it, over a shallow
 * bottom shade. The action button is a sibling of the art link — never nested
 * inside it — so the tile has no interactive-inside-interactive markup.
 * With a `queueTarget`, a queue button (top-right) and a right-click menu
 * offer Play Next / Add to Queue without opening or playing the item.
 */

export function HomeTile({
  href,
  onOpen,
  ariaLabel,
  art,
  title,
  subtitle,
  meta,
  badge,
  aiDisclosure,
  showAiDisclosure = true,
  action,
  queueTarget,
  shape = "square",
}: {
  href: string;
  onOpen?: () => void;
  ariaLabel?: string;
  art: ReactNode;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  aiDisclosure?: AiDisclosure | null;
  /** Artist tiles carry no track disclosure, so they opt out of the badge. */
  showAiDisclosure?: boolean;
  action?: ReactNode;
  /** What the tile queues. Needs the player provider. */
  queueTarget?: CardQueueTarget;
  shape?: "square" | "round";
}) {
  return (
    <article
      className={`ng-tile ng-tile--${shape}${queueTarget ? " ng-tile--queueable" : ""}`}
      data-card-queue={queueTarget ? "" : undefined}
    >
      <div className="ng-tile__art">
        <Link
          href={href}
          className="ng-tile__art-link"
          aria-label={ariaLabel ?? `Open ${title}`}
          onClick={onOpen}
        >
          <span className="ng-tile__media">{art}</span>
          {shape === "square" ? <span className="ng-tile__shade" aria-hidden /> : null}
        </Link>
        {badge ? <span className="ng-tile__badge">{badge}</span> : null}
        {action ? <div className="ng-tile__action-slot">{action}</div> : null}
        {queueTarget ? (
          <div className="ng-tile__queue-slot">
            <CardQueueButton target={queueTarget} />
          </div>
        ) : null}
      </div>
      <div className="ng-tile__body">
        <Link href={href} className="ng-tile__title" onClick={onOpen} tabIndex={-1}>
          {title}
        </Link>
        {subtitle ? <p className="ng-tile__subtitle">{subtitle}</p> : null}
        {meta ? <p className="ng-tile__meta">{meta}</p> : null}
        {showAiDisclosure ? <AiDisclosureBadge disclosure={aiDisclosure} /> : null}
      </div>
    </article>
  );
}
