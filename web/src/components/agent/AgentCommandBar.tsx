"use client";

type Props = {
    name: string;
    isLive: boolean;
    /** Ends the live session. Starting is the prompt's button only (#2237). */
    onStop: () => void;
};

/**
 * The DJ's name and live state, plus Stop only while a session is live. It has
 * no start control: "Start session" lives in the prompt, where what the
 * listener typed or picked travels with it.
 */
export default function AgentCommandBar({ name, isLive, onStop }: Props) {
    return (
        <div className="aid-command" data-testid="agent-command-bar">
            <div className="aid-orb">
                <span className="aid-orb-badge">{name.slice(0, 2).toUpperCase()}</span>
            </div>
            <div className="aid-command-info">
                <span className="aid-command-name">{name}</span>
                <span className={`aid-command-status ${isLive ? "active" : ""}`}>
                    {isLive ? "● Live" : "○ Inactive"}
                </span>
            </div>
            {isLive ? (
                <div className="aid-command-actions">
                    <button type="button" className="aid-toggle-btn stop" onClick={onStop}>
                        Stop Session
                    </button>
                </div>
            ) : null}
        </div>
    );
}
