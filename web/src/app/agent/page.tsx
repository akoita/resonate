"use client";

import Link from "next/link";
import AuthGate from "../../components/auth/AuthGate";
import { useAgentConfig } from "../../hooks/useAgentConfig";
import { useAgentEvents } from "../../hooks/useAgentEvents";
import { useAgentHistory } from "../../hooks/useAgentHistory";
import AgentSetupWizard from "../../components/agent/AgentSetupWizard";
import AgentStatusCard from "../../components/agent/AgentStatusCard";
import AgentActivityFeed from "../../components/agent/AgentActivityFeed";
import AgentBudgetCard from "../../components/agent/AgentBudgetCard";
import AgentTasteCard from "../../components/agent/AgentTasteCard";
import AgentHistoryCard from "../../components/agent/AgentHistoryCard";
import { useToast } from "../../components/ui/Toast";

export default function AgentPage() {
    const { config, isLoading, showWizard, setShowWizard, createConfig, updateConfig, startSession, stopSession } =
        useAgentConfig();
    const events = useAgentEvents();
    const { sessions, isLoading: historyLoading, refetch: refetchHistory } = useAgentHistory();
    const { addToast } = useToast();

    const handleWizardComplete = async (data: {
        name: string;
        vibes: string[];
        monthlyCapUsd: number;
    }) => {
        await createConfig(data);
        addToast({
            type: "success",
            title: "DJ Activated",
            message: `${data.name} is ready to curate!`,
        });
    };

    const handleToggle = async () => {
        if (config?.isActive) {
            await stopSession();
            addToast({
                type: "info",
                title: "Session Stopped",
                message: "Your DJ has paused.",
            });
            // Refetch history to show the completed session
            setTimeout(() => refetchHistory(), 500);
        } else {
            await startSession();
            addToast({
                type: "info",
                title: "Session Started",
                message: "Your DJ is now scanning for tracks!",
            });
            // Refetch history after orchestration completes (LLM may take up to ~30s for multi-genre search)
            setTimeout(() => refetchHistory(), 15000);
            // Safety-net refetch for slower LLM responses
            setTimeout(() => refetchHistory(), 35000);
        }
    };

    const handleEditBudget = () => {
        const newBudget = prompt("Set monthly budget cap (USD):", String(config?.monthlyCapUsd ?? 10));
        if (newBudget && !isNaN(Number(newBudget))) {
            updateConfig({ monthlyCapUsd: Number(newBudget) });
            addToast({
                type: "success",
                title: "Budget Updated",
                message: `Monthly cap set to $${newBudget}`,
            });
        }
    };

    return (
        <AuthGate title="Connect your wallet to access your AI DJ.">
            <main className="agent-dashboard">
                <div className="agent-dashboard-header">
                    <h1 className="agent-dashboard-title">
                        <span className="text-gradient">AI DJ</span>
                    </h1>
                    <p className="agent-dashboard-subtitle">
                        Your personal AI agent that curates, negotiates, and remixes in real-time.
                    </p>
                </div>

                {isLoading ? (
                    <div className="agent-loading">
                        <div className="animate-spin">✨</div>
                        <span>Loading your DJ...</span>
                    </div>
                ) : !config ? (
                    <div className="agent-empty-state">
                        <div className="agent-empty-icon">🤖</div>
                        <h2>Set Up Your AI DJ</h2>
                        <p>Deploy a personal AI agent to scan the catalog, match your mood, and negotiate micro-payments.</p>
                        <button className="ui-btn ui-btn-primary" onClick={() => setShowWizard(true)}>
                            Get Started
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="agent-dashboard-grid">
                            <AgentStatusCard config={config} onToggle={handleToggle} />
                            <AgentActivityFeed isActive={config.isActive} events={events} />
                            <AgentBudgetCard config={config} spentUsd={sessions.reduce((sum, s) => sum + s.spentUsd, 0)} onEdit={handleEditBudget} />
                            <AgentTasteCard
                                config={config}
                                onUpdateVibes={async (vibes) => {
                                    await updateConfig({ vibes });
                                    addToast({ type: "success", title: "Vibes Updated", message: "Your DJ's taste has been updated." });
                                }}
                            />
                        </div>
                        {!historyLoading && sessions.some(s => s.licenses.length > 0) && (
                            <div className="agent-discovery-banner">
                                <div className="agent-discovery-info">
                                    <svg className="agent-discovery-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="2" />
                                        <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
                                        <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
                                    </svg>
                                    <span className="agent-discovery-text">
                                        <strong>{sessions.reduce((sum, s) => sum + s.licenses.length, 0)}</strong> track{sessions.reduce((sum, s) => sum + s.licenses.length, 0) !== 1 ? "s" : ""} discovered across <strong>{sessions.filter(s => s.licenses.length > 0).length}</strong> session{sessions.filter(s => s.licenses.length > 0).length !== 1 ? "s" : ""}
                                    </span>
                                </div>
                                <Link href="/sonic-radar" className="agent-discovery-link">
                                    View all on Sonic Radar
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                </Link>
                            </div>
                        )}
                        <AgentHistoryCard sessions={sessions} isLoading={historyLoading} />
                    </>
                )}
            </main>

            {showWizard && (
                <AgentSetupWizard
                    onComplete={handleWizardComplete}
                    onClose={() => setShowWizard(false)}
                />
            )}
        </AuthGate>
    );
}
