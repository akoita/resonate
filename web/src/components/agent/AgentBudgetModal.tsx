"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface AgentBudgetModalProps {
    isOpen: boolean;
    currentBudget: number;
    spentUsd: number;
    onConfirm: (newBudget: number) => void;
    onClose: () => void;
}

const PRESETS = [5, 10, 25, 50, 100];
const MIN_BUDGET = 1;
const MAX_BUDGET = 500;

/** Wrapper: only mounts inner content when open so state resets naturally */
export default function AgentBudgetModal(props: AgentBudgetModalProps) {
    if (!props.isOpen) return null;
    return <AgentBudgetModalContent {...props} />;
}

function AgentBudgetModalContent({
    currentBudget,
    spentUsd,
    onConfirm,
    onClose,
}: AgentBudgetModalProps) {
    const [budget, setBudget] = useState(currentBudget);
    const [inputValue, setInputValue] = useState(String(currentBudget));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.select(), 150);
        return () => clearTimeout(timer);
    }, []);

    const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const val = Number(e.target.value);
        setBudget(val);
        setInputValue(String(val));
    }, []);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        setInputValue(raw);
        const num = Number(raw);
        if (!isNaN(num) && num >= MIN_BUDGET && num <= MAX_BUDGET) {
            setBudget(num);
        }
    }, []);

    const handleInputBlur = useCallback(() => {
        const num = Number(inputValue);
        if (isNaN(num) || num < MIN_BUDGET) {
            setBudget(MIN_BUDGET);
            setInputValue(String(MIN_BUDGET));
        } else if (num > MAX_BUDGET) {
            setBudget(MAX_BUDGET);
            setInputValue(String(MAX_BUDGET));
        } else {
            setBudget(Math.round(num));
            setInputValue(String(Math.round(num)));
        }
    }, [inputValue]);

    const handlePreset = useCallback((val: number) => {
        setBudget(val);
        setInputValue(String(val));
    }, []);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                handleInputBlur();
                onConfirm(budget);
            } else if (e.key === "Escape") {
                onClose();
            }
        },
        [budget, handleInputBlur, onConfirm, onClose]
    );

    const pct = budget > 0 ? Math.min((spentUsd / budget) * 100, 100) : 0;
    const remaining = Math.max(0, budget - spentUsd);
    const alertLevel =
        pct >= 100 ? "exhausted" : pct >= 95 ? "critical" : pct >= 80 ? "warning" : "ok";
    const changed = budget !== currentBudget;

    return (
        <div className="budget-modal-overlay" onClick={onClose}>
            <div
                className="budget-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Edit Monthly Budget"
            >
                {/* Header */}
                <div className="budget-modal__header">
                    <div className="budget-modal__header-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="1" x2="12" y2="23" />
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="budget-modal__title">Monthly Budget</h3>
                        <p className="budget-modal__subtitle">Set a spending limit for your AI DJ</p>
                    </div>
                    <button className="budget-modal__close" onClick={onClose} aria-label="Close">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Amount display */}
                <div className="budget-modal__amount-display">
                    <span className="budget-modal__currency">$</span>
                    <input
                        ref={inputRef}
                        className="budget-modal__amount-input"
                        type="number"
                        min={MIN_BUDGET}
                        max={MAX_BUDGET}
                        value={inputValue}
                        onChange={handleInputChange}
                        onBlur={handleInputBlur}
                        onKeyDown={handleKeyDown}
                    />
                    <span className="budget-modal__period">/mo</span>
                </div>

                {/* Slider */}
                <div className="budget-modal__slider-container">
                    <input
                        type="range"
                        className="budget-modal__slider"
                        min={MIN_BUDGET}
                        max={MAX_BUDGET}
                        value={budget}
                        onChange={handleSliderChange}
                    />
                    <div className="budget-modal__slider-labels">
                        <span>${MIN_BUDGET}</span>
                        <span>${MAX_BUDGET}</span>
                    </div>
                </div>

                {/* Quick presets */}
                <div className="budget-modal__presets">
                    {PRESETS.map((p) => (
                        <button
                            key={p}
                            className={`budget-modal__preset ${budget === p ? "active" : ""}`}
                            onClick={() => handlePreset(p)}
                        >
                            ${p}
                        </button>
                    ))}
                </div>

                {/* Spending context */}
                <div className="budget-modal__context">
                    <div className="budget-modal__context-row">
                        <span className="budget-modal__context-label">Spent this month</span>
                        <span className="budget-modal__context-value">${spentUsd.toFixed(2)}</span>
                    </div>
                    <div className="budget-modal__progress-track">
                        <div
                            className={`budget-modal__progress-bar budget-modal__progress-bar--${alertLevel}`}
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <div className="budget-modal__context-row">
                        <span className="budget-modal__context-label">Remaining</span>
                        <span className={`budget-modal__context-value budget-modal__context-value--${alertLevel}`}>
                            ${remaining.toFixed(2)}
                        </span>
                    </div>
                    {alertLevel === "warning" && (
                        <div className="budget-modal__alert budget-modal__alert--warning">
                            ⚠️ Approaching budget limit ({pct.toFixed(0)}% used)
                        </div>
                    )}
                    {alertLevel === "critical" && (
                        <div className="budget-modal__alert budget-modal__alert--critical">
                            🚨 Almost at budget limit ({pct.toFixed(0)}% used)
                        </div>
                    )}
                    {alertLevel === "exhausted" && (
                        <div className="budget-modal__alert budget-modal__alert--exhausted">
                            🛑 Budget exceeded — agent purchases will be blocked
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="budget-modal__actions">
                    <button className="budget-modal__btn budget-modal__btn--cancel" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="budget-modal__btn budget-modal__btn--confirm"
                        onClick={() => onConfirm(budget)}
                        disabled={!changed}
                    >
                        {changed ? `Update to $${budget}/mo` : "No Change"}
                    </button>
                </div>
            </div>
        </div>
    );
}
