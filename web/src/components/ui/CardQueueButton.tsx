"use client";

import { useEffect, useRef, useState } from "react";
import { cardQueueIsEmpty, resolveCardQueueTracks, type CardQueueTarget } from "../../lib/cardQueue";
import { useQueueActions } from "../../lib/useQueueActions";
import type { QueueFeedbackMode } from "../../lib/queueFeedback";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { AddToQueueIcon, PlayNextIcon, QueueIcon } from "./MenuIcons";
import { useToast } from "./Toast";

/**
 * Queue a card from where it sits, without opening it or starting playback.
 *
 * Renders a small queue button for the card's artwork that opens a
 * "Play Next / Add to Queue" menu. Right-clicking (or long-pressing, where the
 * browser maps that to a context menu) anywhere on the enclosing card opens the
 * same menu at the pointer: mark the card's root element with
 * `data-card-queue` and drop this button inside it.
 *
 * Shared by every card grid and rail (catalog releases, artists and playlists;
 * the home feed, Trending Now and Top Artists), so a card is queued the same
 * way wherever it appears.
 */
export function CardQueueButton({
  target,
  className = "card-queue-btn",
}: {
  target: CardQueueTarget;
  className?: string;
}) {
  const { queue } = useQueueActions();
  const { addToast } = useToast();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; fromButton: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const empty = cardQueueIsEmpty(target);

  useEffect(() => {
    const card = buttonRef.current?.closest<HTMLElement>("[data-card-queue]");
    if (!card || empty) return;
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, fromButton: false });
    };
    card.addEventListener("contextmenu", handleContextMenu);
    return () => card.removeEventListener("contextmenu", handleContextMenu);
  }, [empty]);

  const queueCard = async (mode: QueueFeedbackMode) => {
    setBusy(true);
    try {
      const tracks = await resolveCardQueueTracks(target);
      if (tracks.length === 0) {
        addToast({
          type: "info",
          title: "Nothing to queue",
          message: `${target.title} has no playable tracks yet.`,
        });
        return;
      }
      queue(tracks, mode);
    } catch (error) {
      console.error("Failed to queue card:", error);
      addToast({
        type: "error",
        title: "Couldn't queue",
        message: `Could not load the tracks of ${target.title}. Try again.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const items: ContextMenuItem[] = [
    { label: "Play Next", icon: <PlayNextIcon />, onClick: () => void queueCard("next") },
    { label: "Add to Queue", icon: <AddToQueueIcon />, onClick: () => void queueCard("queue") },
  ];

  const label = `Queue ${target.title}`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-label={label}
        title={empty ? `${target.title} has no playable tracks yet` : label}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-busy={busy || undefined}
        disabled={empty || busy}
        // The menu closes itself on any outside mousedown; swallowing this one
        // lets a second press on the button close it instead of reopening it.
        onMouseDown={(event) => {
          if (menu) event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (menu) {
            setMenu(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.bottom + 6, fromButton: true });
        }}
      >
        <QueueIcon />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
          openerRef={menu.fromButton ? buttonRef : undefined}
          ariaLabel={`Queue options for ${target.title}`}
        />
      )}
    </>
  );
}
