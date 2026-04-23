export type ProcessingFailureSummary = {
  title: string;
  message: string;
  recovery: string;
  severityLabel: string;
  tone: "error" | "warning";
};

export function summarizeProcessingFailure(rawError?: string | null): ProcessingFailureSummary {
  const normalized = rawError?.toLowerCase() || "";

  if (normalized.includes("cufft") || normalized.includes("cuda") || normalized.includes("cudnn") || normalized.includes("cublas")) {
    return {
      title: "Stem separation hit a worker runtime issue",
      message:
        "The audio upload is fine, but the stem-separation worker crashed while splitting the track.",
      recovery:
        "Retry processing. The worker can fall back to a safer CPU path if the GPU runtime fails again.",
      severityLabel: "Worker retry recommended",
      tone: "warning",
    };
  }

  if (normalized.includes("pub/sub") || normalized.includes("publisher") || normalized.includes("subscription")) {
    return {
      title: "Stem worker handoff is not available",
      message:
        "The release was saved, but the backend could not hand the track to the asynchronous stem worker.",
      recovery: "Wait for the deployment or configuration fix, then retry processing from this page.",
      severityLabel: "Infrastructure check needed",
      tone: "error",
    };
  }

  if (normalized.includes("unauthorized") || normalized.includes("internal service key")) {
    return {
      title: "Internal worker authorization failed",
      message:
        "The stem worker could not complete its trusted callback to the backend.",
      recovery: "This needs an environment configuration fix before retrying.",
      severityLabel: "Configuration needed",
      tone: "error",
    };
  }

  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return {
      title: "Stem processing timed out",
      message:
        "The worker took too long to finish this track. Longer tracks can need a retry after the worker has warmed up.",
      recovery: "Retry processing. If it repeats, try a shorter source file while we inspect worker capacity.",
      severityLabel: "Retry recommended",
      tone: "warning",
    };
  }

  return {
    title: "Stem processing could not finish",
    message:
      "The release was created, but stem separation stopped before the stems were ready.",
    recovery: "Retry processing. The full diagnostic details are available if this keeps happening.",
    severityLabel: "Action needed",
    tone: "error",
  };
}
