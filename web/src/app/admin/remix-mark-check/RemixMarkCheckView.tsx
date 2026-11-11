"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import type {
  RemixWatermarkDetection,
  RemixWatermarkEvidenceSubjectType,
} from "../../../lib/api";
import { formatDateTime } from "../../../lib/adminUsers";

/** Shown with every result, also when the server's own wording is not loaded yet. */
export const REMIX_MARK_CAVEAT =
  "A match shows which remix render this audio came from. It does not show who uploaded or shared it elsewhere. " +
  "Read it together with the licence record for that render and the export history of the same remix project.";

const STATUS_LABELS: Record<RemixWatermarkDetection["status"], string> = {
  pending: "Waiting to start",
  processing: "Checking",
  matched: "Match",
  no_match: "No match",
  failed: "Could not check",
};

const FAILURE_LABELS: Record<NonNullable<RemixWatermarkDetection["failureCode"]>, string> = {
  decode_failed: "The file could not be read as audio. Try MP3, WAV, FLAC, OGG or M4A.",
  detector_failed: "The detector did not run. Try again, and tell engineering if it keeps failing.",
  interrupted: "The check was interrupted before it finished. Upload the clip again.",
};

const BASIS_LABELS: Record<string, string> = {
  owner: "the creator's own stem",
  commercial: "commercial licence",
  remix: "remix licence",
  none: "no licence on record",
};

export function remixMarkStatusLabel(detection: RemixWatermarkDetection): string {
  return STATUS_LABELS[detection.status] ?? detection.status;
}

export function isRemixMarkCheckRunning(detection: RemixWatermarkDetection | null): boolean {
  return detection?.status === "pending" || detection?.status === "processing";
}

export type RemixMarkCheckViewProps = {
  /** Admins only; the server enforces the same rule. */
  allowed: boolean;
  configured: boolean | null;
  current: RemixWatermarkDetection | null;
  recent: RemixWatermarkDetection[];
  busy: boolean;
  error: string | null;
  attachError: string | null;
  onCheck: (clip: File) => void;
  onOpen: (id: string) => void;
  onAttach: (subject: { subjectType: RemixWatermarkEvidenceSubjectType; subjectId: string }) => void;
};

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ opacity: 0.7, fontSize: "12px" }}>{label}</dt>
      <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd>
    </div>
  );
}

function MatchDetails({ detection }: { detection: RemixWatermarkDetection }) {
  const match = detection.match;
  if (!match) return null;
  const { render } = match;
  return (
    <>
      <dl style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", margin: 0 }}>
        <Figure label="Remix project" value={render.remixProjectId} />
        <Figure label="Render job" value={render.generationJobId} />
        <Figure label="Rendered" value={formatDateTime(render.renderedAt)} />
        <Figure label="Source track" value={render.sourceTrackId} />
        {render.secondarySourceTrackId ? (
          <Figure label="Second source track" value={render.secondarySourceTrackId} />
        ) : null}
        <Figure
          label="Found with"
          value={`${match.keySlot === "retired" ? "the retired key" : "the current key"}${match.stage === "speed" ? ", after a speed search" : ""}`}
        />
        <Figure
          label="Detector figures"
          value={`sync ${match.syncQuality ?? "-"} (higher is better), decode error ${match.decodeError ?? "-"} (lower is better)`}
        />
      </dl>
      <p style={{ margin: 0 }}>
        Creator account:{" "}
        <Link href={`/admin/users/${encodeURIComponent(render.ownerUserId)}`}>{render.ownerUserId}</Link>
      </p>
      {render.stemLicenses.length > 0 ? (
        <div>
          <h3 style={{ margin: "0 0 6px", fontSize: "14px" }}>Licence on record for each stem at render time</h3>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {render.stemLicenses.map((licence) => (
              <li key={licence.stemId} style={{ overflowWrap: "anywhere" }}>
                {licence.stemId}: {BASIS_LABELS[licence.basis] ?? licence.basis}
                {licence.stemPurchaseIds.length + licence.x402SettlementIds.length > 0
                  ? ` (${[...licence.stemPurchaseIds, ...licence.x402SettlementIds].join(", ")})`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function AttachForm({
  detection,
  busy,
  error,
  onAttach,
}: Pick<RemixMarkCheckViewProps, "busy" | "onAttach"> & {
  detection: RemixWatermarkDetection;
  error: string | null;
}) {
  const [subjectType, setSubjectType] = useState<RemixWatermarkEvidenceSubjectType>("dispute");
  const [subjectId, setSubjectId] = useState("");
  if (detection.evidenceId) {
    return <p style={{ margin: 0 }}>Attached as evidence. It appears with the other evidence of that case.</p>;
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (subjectId.trim()) onAttach({ subjectType, subjectId: subjectId.trim() });
      }}
      style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "end" }}
    >
      <label style={{ display: "grid", gap: "4px" }}>
        <span>Attach to</span>
        <select
          value={subjectType}
          onChange={(event) => setSubjectType(event.target.value as RemixWatermarkEvidenceSubjectType)}
        >
          <option value="dispute">A dispute</option>
          <option value="release">A release</option>
          <option value="track">A track</option>
        </select>
      </label>
      <label style={{ display: "grid", gap: "4px", flex: "1 1 240px" }}>
        <span>Its id</span>
        <input value={subjectId} onChange={(event) => setSubjectId(event.target.value)} maxLength={200} />
      </label>
      <Button type="submit" disabled={busy || !subjectId.trim()}>
        Attach as evidence
      </Button>
      {error ? (
        <p role="alert" style={{ margin: 0, flexBasis: "100%" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}

export default function RemixMarkCheckView(props: RemixMarkCheckViewProps) {
  const { allowed, configured, current, recent, busy, error } = props;
  const [clip, setClip] = useState<File | null>(null);
  if (!allowed) {
    return (
      <p className="ui-card" style={{ padding: "20px" }}>
        Only admins can check a clip for the remix mark.
      </p>
    );
  }
  const running = isRemixMarkCheckRunning(current);
  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: "960px" }}>
      <header>
        <h1 style={{ margin: 0 }}>Remix mark check</h1>
        <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
          Upload a clip of audio found elsewhere to see whether it came from a remix rendered here.
        </p>
      </header>

      <p className="ui-card" style={{ padding: "16px", margin: 0 }}>
        <strong>What a match means.</strong> {current?.caveat ?? REMIX_MARK_CAVEAT}
      </p>

      {configured === false ? (
        <p className="ui-card" role="status" style={{ padding: "16px", margin: 0 }}>
          Remix marking is not switched on in this environment, so there is nothing to check against yet.
        </p>
      ) : (
        <form
          className="ui-card"
          style={{ padding: "16px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "end" }}
          onSubmit={(event) => {
            event.preventDefault();
            if (clip) props.onCheck(clip);
          }}
        >
          <label style={{ display: "grid", gap: "4px", flex: "1 1 280px" }}>
            <span>Audio clip (30 seconds or more works best; up to 50 MB, the first 10 minutes are checked)</span>
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac"
              onChange={(event) => setClip(event.target.files?.[0] ?? null)}
            />
          </label>
          <Button type="submit" disabled={!clip || busy || running}>
            {running ? "Checking…" : "Check clip"}
          </Button>
        </form>
      )}

      {error ? (
        <p role="alert" className="ui-card" style={{ padding: "16px", margin: 0 }}>
          {error}
        </p>
      ) : null}

      {current ? (
        <section className="ui-card" aria-live="polite" style={{ padding: "16px", display: "grid", gap: "14px" }}>
          <h2 style={{ margin: 0, fontSize: "18px" }}>Result: {remixMarkStatusLabel(current)}</h2>
          {running ? (
            <p style={{ margin: 0 }}>
              This usually takes a few seconds, and up to a few minutes for a long or sped-up clip. You can leave
              this page and come back.
            </p>
          ) : null}
          {current.status === "no_match" ? (
            <p style={{ margin: 0 }}>
              No remix mark was found. That does not prove the audio did not come from here: heavy editing, a pitch
              or tempo change, or a remix made before marking was switched on can all leave nothing to find.
            </p>
          ) : null}
          {current.status === "failed" && current.failureCode ? (
            <p style={{ margin: 0 }}>{FAILURE_LABELS[current.failureCode]}</p>
          ) : null}
          <MatchDetails detection={current} />
          {current.status === "matched" ? (
            <AttachForm detection={current} busy={busy} error={props.attachError} onAttach={props.onAttach} />
          ) : null}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section>
          <h2 style={{ fontSize: "18px" }}>Recent checks</h2>
          <table className="admin-users-table">
            <caption className="visually-hidden">Recent remix mark checks, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Result</th>
                <th scope="col">Evidence</th>
                <th scope="col">
                  <span className="visually-hidden">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map((detection) => (
                <tr key={detection.id}>
                  <td>{formatDateTime(detection.createdAt)}</td>
                  <td>{remixMarkStatusLabel(detection)}</td>
                  <td>{detection.evidenceId ? "Attached" : "-"}</td>
                  <td>
                    <Button type="button" onClick={() => props.onOpen(detection.id)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
