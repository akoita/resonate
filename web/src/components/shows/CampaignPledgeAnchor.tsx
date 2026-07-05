"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  targetId?: string;
}

export function CampaignPledgeAnchor({
  children,
  targetId = "campaign-pledge-rail",
  href,
  onClick,
  ...props
}: Props) {
  return (
    <a
      {...props}
      href={href ?? `#${targetId}`}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;

        const target = document.getElementById(targetId);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      {children}
    </a>
  );
}
