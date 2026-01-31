"use client";

import { useEffect, useRef, useState } from "react";

interface MarqueeTextProps extends React.HTMLAttributes<HTMLDivElement> {
    text: string;
    className?: string;
    speed?: number; // pixels per second
    delay?: number; // seconds before animation starts
}

export function MarqueeText({ text, className = "", speed = 40, delay = 2, ...props }: MarqueeTextProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        const checkOverflow = () => {
            if (containerRef.current && textRef.current) {
                const containerWidth = containerRef.current.offsetWidth;
                const textWidth = textRef.current.scrollWidth;
                const overflowing = textWidth > containerWidth;
                setIsOverflowing(overflowing);

                if (overflowing) {
                    setDuration(textWidth / speed);
                }
            }
        };

        checkOverflow();
        window.addEventListener("resize", checkOverflow);
        return () => window.removeEventListener("resize", checkOverflow);
    }, [text, speed]);

    return (
        <div
            ref={containerRef}
            className={`marquee-container ${isOverflowing ? "is-scrolling" : ""} ${className}`}
            style={{
                "--marquee-duration": `${duration}s`,
                "--marquee-delay": `${delay}s`,
                ...props.style
            } as React.CSSProperties}
            {...props}
        >
            <div ref={textRef} className="marquee-content">
                <span className="marquee-text-main">{text}</span>
                {isOverflowing && <span className="marquee-text-duplicate">{text}</span>}
            </div>
        </div>
    );
}
