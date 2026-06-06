"use client";

import type { ReactNode } from "react";
import { RoomAccessBadge, type RoomAccessModel } from "./roomAccess";

/**
 * Shared room card shell for every community surface (listener cohorts, artist
 * rooms, campaign rooms). Each surface used to ship its own card frame
 * (`listener-cohort-card`, `artist-community-room`, `show-community__room`);
 * this gives them one consistent anatomy — eyebrow + title, an access-badge
 * meta row, a body, and an actions footer — while leaving per-surface content
 * (status chips, descriptions, buttons) to the caller via slots.
 *
 * When `onSelect` is provided the header becomes a button, supporting the
 * artist room-selector pattern (click a room to load its conversation).
 */

export type RoomCardProps = {
  accessModel: RoomAccessModel;
  accessLocked?: boolean;
  /** Short kind label, e.g. "Holder room" or "Taste". */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Extra chips rendered after the access badge (status, member count, role). */
  meta?: ReactNode;
  /** Card body — descriptions, explanations, reasons. */
  children?: ReactNode;
  /** Footer actions (join / leave / details …). */
  actions?: ReactNode;
  selected?: boolean;
  /** When set, the header is a button (room selector). */
  onSelect?: () => void;
  selectLabel?: string;
  /** Surface modifier class, e.g. "room-card--cohort". */
  className?: string;
};

export function RoomCard({
  accessModel,
  accessLocked = false,
  eyebrow,
  title,
  meta,
  children,
  actions,
  selected = false,
  onSelect,
  selectLabel,
  className,
}: RoomCardProps) {
  const head = (
    <>
      {eyebrow ? <span className="room-card__eyebrow">{eyebrow}</span> : null}
      <h4 className="room-card__title">{title}</h4>
    </>
  );

  return (
    <article
      className={`room-card${selected ? " room-card--selected" : ""}${className ? ` ${className}` : ""}`}
    >
      {onSelect ? (
        <button
          type="button"
          className="room-card__head room-card__head--select"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={selectLabel}
        >
          {head}
        </button>
      ) : (
        <div className="room-card__head">{head}</div>
      )}

      <div className="room-card__meta">
        <RoomAccessBadge model={accessModel} locked={accessLocked} />
        {meta}
      </div>

      {children ? <div className="room-card__body">{children}</div> : null}
      {actions ? <div className="room-card__actions">{actions}</div> : null}
    </article>
  );
}
