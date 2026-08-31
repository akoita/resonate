import { useRef, type KeyboardEvent } from "react";

export type TabItem = {
  id: string;
  label: string;
  /** The id of the caller-owned tabpanel controlled by this tab. */
  panelId?: string;
};

type TabsProps = {
  items: TabItem[];
  activeId: string;
  onChange?: (id: string) => void;
  /** Accessible name for the tablist. */
  ariaLabel?: string;
  /** Use an existing visible label instead of the default tablist name. */
  ariaLabelledBy?: string;
};

export function Tabs({
  items,
  activeId,
  onChange,
  ariaLabel = "Tabs",
  ariaLabelledBy,
}: TabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = items.findIndex((item) => item.id === activeId);
  const rovingIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const activateTab = (index: number) => {
    const item = items[index];
    if (!item) return;

    onChange?.(item.id);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (items.length === 0) return;

    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % items.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    activateTab(nextIndex);
  };

  return (
    <div
      className="ui-tabs"
      role="tablist"
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          className={`ui-tab ${item.id === activeId ? "ui-tab-active" : ""}`}
          type="button"
          id={`${item.id}-tab`}
          role="tab"
          aria-selected={item.id === activeId}
          aria-controls={item.panelId}
          tabIndex={index === rovingIndex ? 0 : -1}
          onClick={() => onChange?.(item.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
