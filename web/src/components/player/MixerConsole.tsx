"use client";

import React, { useState, useRef } from "react";
import { usePlayer } from "../../lib/playerContext";

interface MixerConsoleProps {
    onClose?: () => void;
    className?: string;
    showCloseButton?: boolean;
}

export function MixerConsole({ onClose, className = "", showCloseButton = true }: MixerConsoleProps) {
    const { mixerVolumes, setMixerVolumes, toggleMixerMode, isPlaying, currentTrack } = usePlayer();
    const hasStems = currentTrack?.stems && currentTrack.stems.some(s => s.type.toUpperCase() !== 'ORIGINAL');

    // Drag state
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const offsetRef = useRef({ x: 0, y: 0 });

    const handleVolumeChange = (type: string, value: number) => {
        setMixerVolumes({
            ...mixerVolumes,
            [type]: value,
        });
    };

    // Prevent any events from bubbling up when interacting with the mixer
    const stopPropagation = (e: React.SyntheticEvent | React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
        e.stopPropagation();
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!containerRef.current) return;

        e.preventDefault();
        e.stopPropagation();

        const rect = containerRef.current.getBoundingClientRect();
        offsetRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };

        setPosition({ x: rect.left, y: rect.top });
        setIsDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        setPosition({
            x: e.clientX - offsetRef.current.x,
            y: e.clientY - offsetRef.current.y,
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!isDragging) return;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        setIsDragging(false);
    };

    const stems = [
        { id: "vocals", label: "Vocals", icon: "🎤" },
        { id: "drums", label: "Drums", icon: "🥁" },
        { id: "bass", label: "Bass", icon: "🎸" },
        { id: "piano", label: "Piano", icon: "🎹" },
        { id: "guitar", label: "Guitar", icon: "🎸" },
        { id: "other", label: "Other", icon: "🎷" },
    ];

    const positionStyle = position ? {
        position: 'fixed' as const,
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'none',
        width: 'min(520px, 85vw)',
        maxWidth: '520px',
        zIndex: 300,
        bottom: 'auto',
    } : {};

    return (
        <div
            ref={containerRef}
            className={`mixer-console glass-panel ${className} ${isDragging ? 'dragging' : ''}`}
            style={positionStyle}
            onClick={stopPropagation}
            onDragStart={(e) => {
                e.preventDefault();
                stopPropagation(e);
            }}
        >
            {/* Drag Handle Bar */}
            <div 
                className="mixer-drag-bar"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ touchAction: 'none' }}
            >
                <div className="mixer-drag-bar-indicator" />
            </div>

            <div className="mixer-header">
                <div className="mixer-title-area">
                    <span className="mixer-icon">🎚️</span>
                    <div className="mixer-titles">
                        <h3 className="mixer-title">Studio Mixer</h3>
                        {currentTrack && <p className="mixer-track-name">{currentTrack.title}</p>}
                    </div>
                    <div className={`mixer-status-led ${isPlaying ? 'animate-pulse' : 'static'} ${hasStems ? 'led-green' : 'led-amber'}`} />
                </div>
                {showCloseButton && (
                    <div className="mixer-actions">
                        <button
                            className="mixer-close-btn"
                            onClick={(e) => {
                                stopPropagation(e);
                                if (onClose) onClose();
                                else toggleMixerMode();
                            }}
                        >
                            &times;
                        </button>
                    </div>
                )}
            </div>

            <div className="mixer-grid">
                {stems.map((stem) => (
                    <div key={stem.id} className={`mixer-channel ${!hasStems ? 'opacity-20 pointer-events-none' : ''}`}>
                        <div className="mixer-label">
                            <span className="mixer-label-icon">{stem.icon}</span>
                            <span className="mixer-label-title">{stem.label}</span>
                        </div>
                        <div
                            className="mixer-slider-container"
                            onMouseDown={stopPropagation}
                            onPointerDown={stopPropagation}
                            onTouchStart={stopPropagation}
                        >
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={mixerVolumes[stem.id] ?? 1}
                                onChange={(e) => handleVolumeChange(stem.id, parseFloat(e.target.value))}
                                onMouseDown={stopPropagation}
                                onPointerDown={stopPropagation}
                                onTouchStart={stopPropagation}
                                onClick={stopPropagation}
                                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                className="mixer-slider"
                            />
                        </div>
                        <div className="mixer-value">
                            {Math.round((mixerVolumes[stem.id] ?? 1) * 100)}%
                        </div>
                    </div>
                ))}

                {!hasStems && (
                    <div className="mixer-overlay">
                        <div className="mixer-overlay-content">
                            <span className="mixer-overlay-icon">⏳</span>
                            <p className="mixer-overlay-text">Stems not available for this track yet.</p>
                            <span className="mixer-overlay-hint">Original audio playing instead.</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="mixer-footer">
                <span className="mixer-sync-text">ALL STEMS SYNCHRONIZED VIA SYSTEM CLOCK</span>
            </div>

            <style jsx>{`
                .mixer-console {
                    padding: var(--space-5);
                    border-radius: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-4);
                    background: rgba(15, 15, 20, 0.98);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
                    user-select: none;
                    -webkit-user-drag: none;
                }

                .mixer-console.dragging {
                    cursor: grabbing;
                    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7);
                    opacity: 0.95;
                }

                .mixer-drag-bar {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 8px 0 4px 0;
                    cursor: grab;
                    user-select: none;
                    margin: -20px -20px 12px -20px;
                    border-radius: 24px 24px 0 0;
                    transition: background 0.2s;
                }

                .mixer-drag-bar:hover {
                    background: rgba(255, 255, 255, 0.03);
                }

                .mixer-drag-bar:active {
                    cursor: grabbing;
                }

                .mixer-drag-bar-indicator {
                    width: 48px;
                    height: 5px;
                    background: rgba(255, 255, 255, 0.25);
                    border-radius: 3px;
                    transition: all 0.2s;
                }

                .mixer-drag-bar:hover .mixer-drag-bar-indicator {
                    background: rgba(255, 255, 255, 0.4);
                    width: 60px;
                }

                .mixer-console.dragging .mixer-drag-bar-indicator {
                    background: var(--color-accent);
                    width: 70px;
                }

                .mixer-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    padding-bottom: 12px;
                }

                .mixer-title-area {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .mixer-icon {
                    font-size: 20px;
                }

                .mixer-title {
                    font-size: 14px;
                    font-weight: 800;
                    margin: 0;
                    letter-spacing: 0.05em;
                    text-transform: uppercase;
                    color: #fff;
                }

                .mixer-titles {
                    display: flex;
                    flex-direction: column;
                }

                .mixer-track-name {
                    font-size: 10px;
                    color: rgba(255, 255, 255, 0.5);
                    font-weight: 600;
                    margin: 0;
                }

                .mixer-status-led {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #444;
                    margin-left: 12px;
                    box-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
                }

                .mixer-status-led.animate-pulse {
                    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                }

                .mixer-status-led.static {
                    background: #6b7280;
                    box-shadow: none;
                }

                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.3; }
                }

                .mixer-close-btn {
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: #fff;
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .mixer-close-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                    transform: scale(1.1);
                }

                .mixer-grid {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    height: 220px;
                    padding: 8px 0;
                    position: relative;
                }

                .mixer-channel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    background: rgba(255, 255, 255, 0.03);
                    padding: 12px 4px;
                    border-radius: 12px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    min-width: 0;
                    overflow: hidden;
                }

                .mixer-label {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 2px;
                    width: 100%;
                }

                .mixer-label-icon {
                    font-size: 16px;
                    line-height: 1;
                }

                .mixer-label-title {
                    font-size: 9px;
                    font-weight: 800;
                    text-transform: uppercase;
                    color: rgba(255, 255, 255, 0.5);
                    letter-spacing: 0.05em;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                    text-align: center;
                }

                .mixer-slider-container {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    min-height: 0;
                }

                .mixer-slider {
                    -webkit-appearance: none;
                    width: 120px;
                    height: 6px;
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 3px;
                    outline: none;
                    transform: rotate(-90deg);
                    cursor: pointer;
                    box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);
                }

                .mixer-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 20px;
                    height: 20px;
                    background: #fff;
                    border-radius: 4px;
                    border: 2px solid var(--color-accent);
                    box-shadow: 0 0 15px var(--color-accent);
                    cursor: pointer;
                }

                .mixer-value {
                    font-size: 10px;
                    font-weight: 700;
                    font-family: monospace;
                    color: var(--color-accent);
                    background: rgba(124, 92, 255, 0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                    white-space: nowrap;
                }

                .mixer-overlay {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(15, 15, 20, 0.85);
                    border-radius: 12px;
                    z-index: 10;
                    backdrop-filter: blur(4px);
                }

                .mixer-overlay-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    text-align: center;
                    padding: 16px;
                }

                .mixer-overlay-icon {
                    font-size: 24px;
                }

                .mixer-overlay-text {
                    font-size: 13px;
                    font-weight: 600;
                    color: rgba(255, 255, 255, 0.8);
                    margin: 0;
                }

                .mixer-overlay-hint {
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.4);
                }

                .opacity-20 {
                    opacity: 0.2;
                }

                .pointer-events-none {
                    pointer-events: none;
                }

                .mixer-footer {
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                    padding-top: 12px;
                    text-align: center;
                }

                .mixer-sync-text {
                    font-size: 8px;
                    color: rgba(255, 255, 255, 0.3);
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                }
            `}</style>
        </div>
    );
}
