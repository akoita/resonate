"use client";
import type React from "react";

type CardProps = {
  title?: string;
  image?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  variant?: "standard" | "featured" | "compact";
  onClick?: () => void;
};

export function Card({ title, image, children, className, style, variant = "standard", onClick }: CardProps) {
  if (variant === "compact") {
    return (
      <div
        className={`ui-card-compact glass-panel ${className || ""}`}
        style={style}
        onClick={onClick}
      >
        <div className="compact-image-container">
          {image ? (
            <img src={image} alt={title} className="compact-image" />
          ) : (
            <div className="compact-placeholder">🎵</div>
          )}
        </div>
        <div className="compact-title">{title}</div>

        <style jsx>{`
          .ui-card-compact {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 0;
            cursor: pointer;
            overflow: hidden;
            border-radius: 8px;
            height: 64px;
          }
          .compact-image-container {
            width: 64px;
            height: 64px;
            flex-shrink: 0;
            background: rgba(255, 255, 255, 0.05);
          }
          .compact-image {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .compact-placeholder {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
          }
          .compact-title {
            font-size: 14px;
            font-weight: 700;
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding-right: 16px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      className={`ui-card ${variant === 'featured' ? 'ui-card-featured' : ''} ${className || ""}`}
      style={style}
      onClick={onClick}
    >
      {image ? (
        <div className="ui-card-image shimmer-mask">
          <img src={image} alt={title} />
        </div>
      ) : (
        <div className="ui-card-image-placeholder">
          <div className="placeholder-icon">🎵</div>
        </div>
      )}
      {title ? <div className="ui-card-title">{title}</div> : null}
      <div className="ui-card-body">{children}</div>

      <style jsx>{`
        .ui-card-featured {
          grid-column: span 2;
        }
        .ui-card-image {
          aspect-ratio: ${variant === 'featured' ? '21 / 9' : '1 / 1'};
          transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .ui-card:hover .ui-card-image img {
          transform: scale(1.1);
        }
      `}</style>
    </div>
  );
}
