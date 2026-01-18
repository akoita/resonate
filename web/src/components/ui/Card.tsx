import type React from "react";

type CardProps = {
  title?: string;
  children: React.ReactNode;
};

export function Card({ title, children }: CardProps) {
  return (
    <div className="ui-card">
      {title ? <div className="ui-card-title">{title}</div> : null}
      <div className="ui-card-body">{children}</div>
    </div>
  );
}
