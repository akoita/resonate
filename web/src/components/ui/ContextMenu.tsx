"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    variant?: "default" | "destructive";
    separator?: boolean;
};

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    // Adjust positioning to not overflow screen
    const style = {
        top: y,
        left: x,
    };

    // Simple portal to body to ensure it's on top
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[200px] bg-[#1E1E1E]/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
            style={style}
            onContextMenu={(e) => e.preventDefault()}
        >
            {items.map((item, index) => (
                <div key={index}>
                    {item.separator && <div className="h-[1px] bg-white/5 my-1" />}
                    {!item.separator && (
                        <button
                            onClick={() => {
                                item.onClick();
                                onClose();
                            }}
                            className={`w-full text-left px-4 py-2 text-[13px] font-medium flex items-center gap-3 hover:bg-white/10 transition-all active:scale-95
                  ${item.variant === "destructive" ? "text-red-400 hover:text-red-300 hover:bg-red-500/10" : "text-white/80 hover:text-white"}
                `}
                        >
                            {item.icon && <span className="w-5 h-5 flex items-center justify-center text-sm opacity-80">{item.icon}</span>}
                            <span>{item.label}</span>
                        </button>
                    )}
                </div>
            ))}
        </div>,
        document.body
    );
}
