import type React from "react";

type TabItem = {
  id: string;
  label: string;
};

type TabsProps = {
  items: TabItem[];
  activeId: string;
  onChange?: (id: string) => void;
};

export function Tabs({ items, activeId, onChange }: TabsProps) {
  return (
    <div className="ui-tabs">
      {items.map((item) => (
        <button
          key={item.id}
          className={`ui-tab ${item.id === activeId ? "ui-tab-active" : ""}`}
          type="button"
          onClick={() => onChange?.(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
