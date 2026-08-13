"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type SplitButtonItem = {
  key: string;
  label: string;
  /** Optional second line explaining what the item does. */
  description?: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

interface SplitButtonProps {
  /** Label of the always-visible default action. */
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Secondary actions, revealed by the caret. */
  items: SplitButtonItem[];
  variant?: "primary" | "ghost";
  disabled?: boolean;
  /** Accessible name of the caret, e.g. "More queue actions". */
  menuLabel: string;
  className?: string;
}

/**
 * One control, two tiers: the action people take 90% of the time stays a
 * single click, and its rarer siblings live behind a caret instead of eating
 * another slot in the header. Replaces rows of equally-weighted ghost buttons,
 * which made every action look equally important and pushed the real primary
 * action off the first line on narrow viewports.
 */
export function SplitButton({
  label,
  icon,
  onClick,
  items,
  variant = "ghost",
  disabled = false,
  menuLabel,
  className = "",
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) caretRef.current?.focus();
  }, []);

  /* Placement is a DOM concern, written straight to the node: routing it
   * through state would re-render the menu on every scroll frame. */
  const position = useCallback(() => {
    const menu = menuRef.current;
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!menu || !trigger) return;

    const gutter = 12;
    const menuWidth = Math.max(menu.offsetWidth, 240);
    const menuHeight = menu.offsetHeight;
    const fitsBelow = trigger.bottom + 8 + menuHeight <= window.innerHeight - gutter;

    menu.style.top = `${fitsBelow ? trigger.bottom + 8 : Math.max(gutter, trigger.top - menuHeight - 8)}px`;
    menu.style.left = `${Math.min(
      Math.max(gutter, trigger.right - menuWidth),
      Math.max(gutter, window.innerWidth - menuWidth - gutter),
    )}px`;
    menu.style.visibility = "visible";
    menu.classList.toggle("is-above", !fitsBelow);
  }, []);

  /** Position as soon as the portal node exists, before it can be painted. */
  const attachMenu = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node;
    if (node) position();
  }, [position]);

  // Keep the menu anchored while the viewport moves under it.
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
    };
    const handleViewportChange = () => position();

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, position, close]);

  const focusItem = (index: number) => {
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)");
    if (!buttons?.length) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [],
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case "Escape":
        event.stopPropagation();
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        focusItem(current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(buttons.length - 1);
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  };

  const openMenu = (focusFirst: boolean) => {
    setOpen(true);
    if (focusFirst) requestAnimationFrame(() => focusItem(0));
  };

  const shellClass = [
    "split-button",
    `split-button--${variant}`,
    open ? "is-open" : "",
    disabled ? "is-disabled" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass} ref={rootRef}>
      <button type="button" className="split-button__action" onClick={onClick} disabled={disabled}>
        {icon && <span className="split-button__icon">{icon}</span>}
        <span className="split-button__label">{label}</span>
      </button>

      <span className="split-button__divider" aria-hidden="true" />

      <button
        type="button"
        ref={caretRef}
        className="split-button__caret"
        onClick={() => (open ? close(false) : openMenu(false))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMenu(true);
          }
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={menuLabel}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          id={menuId}
          ref={attachMenu}
          role="menu"
          aria-label={menuLabel}
          className="split-button__menu"
          style={{ top: 0, left: 0, visibility: "hidden" }}
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="split-button__menu-item"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                close();
              }}
            >
              {item.icon && <span className="split-button__menu-icon">{item.icon}</span>}
              <span className="split-button__menu-copy">
                <span>{item.label}</span>
                {item.description && <small>{item.description}</small>}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
