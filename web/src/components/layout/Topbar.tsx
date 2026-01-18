"use client";

import type React from "react";
import ConnectButton from "../auth/ConnectButton";

type TopbarProps = {
  title?: string;
  actions?: React.ReactNode;
};

export default function Topbar({ title, actions }: TopbarProps) {
  return (
    <div className="app-topbar">
      <div>{title ?? "Discover"}</div>
      <div>{actions ?? <ConnectButton />}</div>
    </div>
  );
}
