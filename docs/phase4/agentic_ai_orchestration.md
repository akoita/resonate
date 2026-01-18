# Phase 4: Agentic AI + GenAI Orchestration (Research + Plan)

## Goals
- Replace heuristic selection with agentic policy + tool orchestration.
- Enable multi-agent coordination for transitions, remixing, and negotiation.
- Keep an evaluation harness to compare policies and avoid regressions.

## Ecosystem Survey (2024/2025)
- **Google Vertex AI / Agents / ADK**: Strong for tool calling, policy control, and
  integration with GCP data sources.
- **LangGraph (LangChain)**: Best-in-class for multi-agent graphs and stateful flows.
- **OpenAI tools / Assistants**: Good orchestration, but less control over infra.

## Recommended Stack (v1)
- **Runtime**: Vertex AI Agent or LangGraph (server-side).
- **Policy Layer**: Deterministic policy + LLM arbitration.
- **Retrieval**: Catalog + analytics features as tools (genre, mood, budgets).
- **Safety**: Budget caps + explicit content filters enforced outside LLM.

## Agent Roles
- **Selector**: chooses candidate tracks.
- **Mixer**: plans transitions/remix strategy.
- **Negotiator**: selects license type and price within cap.

## Evaluation Harness
- Replay sessions with fixed seeds.
- Metrics: acceptance rate, budget adherence, repeat avoidance, session length.
- Offline test data: curated catalog snapshots.

## Implementation Plan (v1)
- Add `AgentPolicyService` with explicit policy rules.
- Add `AgentRunnerService` with tool registry and evaluation hooks.
- Expose `/agents/run` endpoint (internal or admin).
- Add `agent.evaluated` event for analytics.
- Add multi-role orchestrator: Selector/Mixer/Negotiator.

## Implemented (Phase 4)
- Tool registry with catalog + pricing tools (local).
- Selector/Mixer/Negotiator services wired via orchestrator.
- `/agents/orchestrate` admin endpoint.
- Agent orchestration events: `agent.selection`, `agent.mix_planned`,
  `agent.negotiated`, `agent.evaluated`.
- Evaluation harness `/agents/evaluate` with replay metrics.
- Embedding service + similarity scoring for selection ranking.

## Next Steps
- Integrate Vertex AI tool calling (planned).
- Add vector similarity for mood/genre embeddings.
