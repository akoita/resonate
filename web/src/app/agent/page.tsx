"use client";

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
            // Refetch history after orchestration completes (gives time for track selection + persistence)
            setTimeout(() => refetchHistory(), 3000);
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
                            <AgentTasteCard config={config} />
                        </div>
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
