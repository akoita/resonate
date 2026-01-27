import type React from "react";

type CardProps = {
  title?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function Card({ title, children, className, style }: CardProps) {
  return (
    <div className={`ui-card ${className || ""}`} style={style}>
      {title ? <div className="ui-card-title">{title}</div> : null}
      <div className="ui-card-body">{children}</div>
    </div>
  );
}
