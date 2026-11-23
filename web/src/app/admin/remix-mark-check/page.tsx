"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import {
  attachRemixWatermarkEvidence,
  getRemixWatermarkDetection,
  listRemixWatermarkDetections,
  startRemixWatermarkDetection,
  type RemixWatermarkDetection,
  type RemixWatermarkEvidenceSubjectType,
} from "../../../lib/api";
import { registerVisibleInterval } from "../../../lib/visibleInterval";
import RemixMarkCheckView, { isRemixMarkCheckRunning } from "./RemixMarkCheckView";

const POLL_MS = 3000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/** #2575: check a clip for the remix mark. Admin only; the server enforces the same rule. */
function RemixMarkCheck() {
  const { token, role } = useAuth();
  const allowed = role === "admin";
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recent, setRecent] = useState<RemixWatermarkDetection[]>([]);
  const [current, setCurrent] = useState<RemixWatermarkDetection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!token) return;
    const list = await listRemixWatermarkDetections(token);
    setConfigured(list.configured);
    setRecent(list.detections);
  }, [token]);

  useEffect(() => {
    if (!token || !allowed) return;
    refreshList().catch((caught: unknown) => setError(messageOf(caught)));
  }, [token, allowed, refreshList]);

  const running = isRemixMarkCheckRunning(current);
  const currentId = current?.id;
  useEffect(() => {
    if (!token || !running || !currentId) return;
    return registerVisibleInterval(() => {
      getRemixWatermarkDetection(token, currentId)
        .then((detection) => {
          setCurrent(detection);
          if (!isRemixMarkCheckRunning(detection)) void refreshList().catch(() => undefined);
        })
        .catch((caught: unknown) => setError(messageOf(caught)));
    }, POLL_MS);
  }, [token, running, currentId, refreshList]);

  const run = async (work: () => Promise<void>, onError: (message: string) => void) => {
    setBusy(true);
    setError(null);
    setAttachError(null);
    try {
      await work();
    } catch (caught) {
      onError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RemixMarkCheckView
      allowed={allowed}
      configured={configured}
      current={current}
      recent={recent}
      busy={busy}
      error={error}
      attachError={attachError}
      onCheck={(clip: File) => {
        if (!token) return;
        void run(async () => setCurrent(await startRemixWatermarkDetection(token, clip)), setError);
      }}
      onOpen={(id: string) => {
        if (!token) return;
        void run(async () => setCurrent(await getRemixWatermarkDetection(token, id)), setError);
      }}
      onAttach={(subject: { subjectType: RemixWatermarkEvidenceSubjectType; subjectId: string }) => {
        if (!token || !current) return;
        void run(async () => {
          const attached = await attachRemixWatermarkEvidence(token, current.id, subject);
          setCurrent(attached.detection);
          await refreshList();
        }, setAttachError);
      }}
    />
  );
}

export default function AdminRemixMarkCheckPage() {
  return (
    <AuthGate title="Sign in with an admin account to check a clip for the remix mark.">
      <RemixMarkCheck />
    </AuthGate>
  );
}
