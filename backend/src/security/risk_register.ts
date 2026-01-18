export interface RiskItem {
  name: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  mitigation: string;
}

export const riskRegister: RiskItem[] = [
  {
    name: "L2 instability",
    likelihood: "medium",
    impact: "medium",
    mitigation: "Failover plan and monitoring.",
  },
  {
    name: "Pricing abuse",
    likelihood: "medium",
    impact: "high",
    mitigation: "Floors/ceilings and alerting.",
  },
  {
    name: "AI latency",
    likelihood: "medium",
    impact: "medium",
    mitigation: "Async processing and caching.",
  },
];
