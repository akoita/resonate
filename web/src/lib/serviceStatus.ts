/**
 * Service status (#2667): ready-made `incident` broadcasts to everyone, so an
 * operator can post a status banner in one step. The newest active one also
 * shows on the sign-in screen for people who cannot sign in.
 */

export type ServiceStatusTemplateId = "degraded" | "incident" | "resolved";

export interface ServiceStatusTemplate {
  id: ServiceStatusTemplateId;
  label: string;
  title: string;
  body: string;
  /** Ends by itself this long after sending; null stays until an operator ends it. */
  expiresInHours: number | null;
}

export const SERVICE_STATUS_TEMPLATES: readonly ServiceStatusTemplate[] = [
  {
    id: "degraded",
    label: "Slow or partly down",
    title: "Some features are slow right now",
    body:
      "Some parts of Resonate are slower than usual or not fully working. Your music, purchases and earnings are safe. "
      + "We are working on it and will post an update here.",
    expiresInHours: null,
  },
  {
    id: "incident",
    label: "Outage",
    title: "Resonate is having problems",
    body:
      "Some people cannot sign in, play or upload right now. Your music, purchases and earnings are safe. "
      + "We are working on a fix and will post an update here.",
    expiresInHours: null,
  },
  {
    id: "resolved",
    label: "Resolved",
    title: "Everything is working again",
    body:
      "The earlier problem is fixed and Resonate is working normally. Thank you for your patience. "
      + "If something still looks wrong, contact support.",
    expiresInHours: 24,
  },
];

export function serviceStatusTemplate(id: ServiceStatusTemplateId): ServiceStatusTemplate {
  const template = SERVICE_STATUS_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Unknown service status template: ${id}`);
  return template;
}

