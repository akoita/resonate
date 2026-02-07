"use client";

import type { AgentConfig } from "../../lib/api";

type Props = {
    config: AgentConfig;
    spentUsd: number;
    onEdit: () => void;
};

export default function AgentBudgetCard({ config, spentUsd, onEdit }: Props) {
    const spent = spentUsd;
    const pct = config.monthlyCapUsd > 0 ? Math.min((spent / config.monthlyCapUsd) * 100, 100) : 0;
    const circumference = 2 * Math.PI * 45;
    const dashOffset = circumference - (pct / 100) * circumference;

    return (
        <div className="agent-card agent-budget-card">
            <h3 className="agent-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                Monthly Budget
            </h3>

            <div className="agent-budget-visual">
                <svg viewBox="0 0 100 100" className="agent-budget-ring">
                    <circle cx="50" cy="50" r="45" className="agent-budget-ring-bg" />
                    <circle
                        cx="50"
                        cy="50"
                        r="45"
                        className="agent-budget-ring-fill"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        transform="rotate(-90 50 50)"
                    />
                </svg>
                <div className="agent-budget-center">
                    <span className="agent-budget-amount">${spent.toFixed(2)}</span>
                    <span className="agent-budget-cap">of ${config.monthlyCapUsd}/mo</span>
                </div>
            </div>

            <button className="agent-edit-btn" onClick={onEdit}>
                Edit Budget
            </button>
        </div>
    );
}
