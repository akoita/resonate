import type React from "react";

type TopbarProps = {
  title?: string;
  actions?: React.ReactNode;
};

export default function Topbar({ title, actions }: TopbarProps) {
  return (
    <div className="app-topbar">
      <div>{title ?? "Discover"}</div>
      <div>{actions}</div>
    </div>
  );
}
