"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { CrateLine, type TransitionPreviewState } from "../../../components/crates/CrateLine";
import { CrateQuotePanel } from "../../../components/crates/CrateQuotePanel";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useToast } from "../../../components/ui/Toast";
import {
  createCrateRequest,
  getCrate,
  getStemPreviewUrl,
  swapCrateLine,
  updateCrate,
} from "../../../lib/api";
import {
  canMoveLine,
  clampCount,
  coverageSummary,
  CRATE_MAX_COUNT,
  CRATE_MIN_COUNT,
  CRATE_TITLE_MAX_LENGTH,
  crateErrorMessage,
  crateErrorStatus,
  filterChips,
  filtersEqual,
  itemsChanged,
  moveLine,
  patchItemsPayload,
  readCrateCreationNotes,
  removeChip,
  removeLine,
  storeCrateCreationNotes,
  toggleLock,
  transitionFacts,
  withBpmRange,
  type CrateCreationNotes,
  type CrateDto,
  type CrateFilters,
  type CrateItemDto,
  type CrateQuote,
} from "../../../lib/crates";
import {
  createCrateTransitionPlayer,
  type CrateTransitionPlayer,
} from "../../../lib/crateTransitionPreview";
import "../../../styles/crates.css";

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function CrateEditor({ crateId }: { crateId: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();

  const [crate, setCrate] = useState<CrateDto | null>(null);
  const [items, setItems] = useState<CrateItemDto[]>([]);
  const [title, setTitle] = useState("");
  const [filters, setFilters] = useState<CrateFilters | null>(null);
  const [notes, setNotes] = useState<CrateCreationNotes | null>(null);
  const [latestQuote, setLatestQuote] = useState<CrateQuote | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CrateItemDto | null>(null);
  const [preview, setPreview] = useState<{ trackId: string; state: "loading" | "playing" } | null>(
    null,
  );
  const playerRef = useRef<CrateTransitionPlayer | null>(null);

  const adopt = useCallback((next: CrateDto) => {
    setCrate(next);
    setItems(next.items);
    setTitle(next.title ?? "");
    setFilters(next.filters);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoadState("loading");
    getCrate(token, crateId)
      .then((result) => {
        if (cancelled) return;
        adopt(result.crate);
        setLatestQuote(result.latestQuote ?? null);
        setNotes(readCrateCreationNotes(crateId));
        setLoadState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadState(crateErrorStatus(err) === 404 ? "missing" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [adopt, crateId, token]);

  useEffect(() => {
    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const titleChanged = crate !== null && title.trim() !== (crate.title ?? "").trim();
  const orderChanged = crate !== null && itemsChanged(crate.items, items);
  const dirty = titleChanged || orderChanged;
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // After a purchase, read the crate again so lines that sold out show as such.
  // Unsaved edits are never replaced.
  const refreshAfterPurchase = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getCrate(token, crateId);
      if (!dirtyRef.current) adopt(result.crate);
    } catch {
      // The receipts are already on screen; the crate refreshes on the next visit.
    }
  }, [adopt, crateId, token]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const stopPreview = useCallback(() => {
    playerRef.current?.stop();
    setPreview(null);
  }, []);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      addToast({ type: "error", title: fallback, message: crateErrorMessage(err, "Please try again.") });
    },
    [addToast],
  );

  const persist = useCallback(
    async (extra: { status?: "saved" } = {}) => {
      if (!token || !crate) return null;
      const result = await updateCrate(token, crate.id, {
        title: title.trim() === "" ? null : title.trim(),
        items: patchItemsPayload(items),
        ...extra,
      });
      adopt(result.crate);
      return result.crate;
    },
    [adopt, crate, items, title, token],
  );

  const onSave = async () => {
    setBusy(true);
    stopPreview();
    try {
      const saved = await persist({ status: "saved" });
      if (saved) addToast({ type: "success", title: "Crate saved" });
    } catch (err) {
      fail(err, "Could not save the crate");
    } finally {
      setBusy(false);
    }
  };

  const onSwap = async (item: CrateItemDto) => {
    if (!token || !crate) return;
    setBusy(true);
    stopPreview();
    try {
      // The server swaps against its own copy, so send pending edits first.
      if (dirty) await persist();
      const result = await swapCrateLine(token, crate.id, item.trackId);
      adopt(result.crate);
      addToast(
        result.swapped
          ? { type: "success", title: "Swapped for a similar track" }
          : {
              type: "info",
              title: "Nothing fits better",
              message: "No other track matches this crate's filters well enough to swap in.",
            },
      );
    } catch (err) {
      fail(err, "Could not swap that line");
    } finally {
      setBusy(false);
    }
  };

  const onMove = (index: number, direction: -1 | 1) => {
    stopPreview();
    setItems((current) => moveLine(current, index, index + direction));
  };

  const onConfirmRemove = () => {
    if (!removeTarget) return;
    stopPreview();
    setItems((current) => removeLine(current, removeTarget.trackId));
    setRemoveTarget(null);
  };

  const onPreview = async (index: number) => {
    const from = items[index];
    const to = items[index + 1];
    if (!from?.originalStemId || !to?.originalStemId) return;
    if (preview?.trackId === from.trackId) {
      stopPreview();
      return;
    }
    if (!playerRef.current) {
      playerRef.current = createCrateTransitionPlayer({ urlForStem: getStemPreviewUrl });
    }
    setPreview({ trackId: from.trackId, state: "loading" });
    try {
      await playerRef.current.play({
        fromStemId: from.originalStemId,
        toStemId: to.originalStemId,
        fromBpm: from.tempoBpm,
        toBpm: to.tempoBpm,
        onStarted: () => setPreview({ trackId: from.trackId, state: "playing" }),
      });
      setPreview((current) => (current?.trackId === from.trackId ? null : current));
    } catch {
      setPreview(null);
      addToast({
        type: "error",
        title: "Preview unavailable",
        message: "One of these tracks could not be loaded for a preview.",
      });
    }
  };

  const onRebuild = async () => {
    if (!token || !filters) return;
    setBusy(true);
    stopPreview();
    try {
      const response = await createCrateRequest(token, {
        filters: { ...filters, count: clampCount(filters.count) },
      });
      storeCrateCreationNotes(response.crate.id, response);
      router.push(`/crates/${encodeURIComponent(response.crate.id)}`);
    } catch (err) {
      fail(err, "Could not build a new crate");
      setBusy(false);
    }
  };

  const chips = useMemo(() => (filters ? filterChips(filters) : []), [filters]);
  const filtersChanged = crate !== null && filters !== null && !filtersEqual(crate.filters, filters);

  if (loadState === "loading") {
    return (
      <div className="crates-page" aria-busy="true">
        <p className="crates-hint">Loading your crate…</p>
      </div>
    );
  }

  if (loadState !== "ready" || !crate || !filters) {
    return (
      <div className="crates-page">
        <h1>{loadState === "missing" ? "Crate not found" : "Could not load this crate"}</h1>
        <p className="crates-lede">
          {loadState === "missing"
            ? "This crate does not exist or belongs to someone else."
            : "Something went wrong loading this crate. Please try again."}
        </p>
        <div className="crates-row">
          <Link className="crates-btn" href="/crates">
            Back to your crates
          </Link>
        </div>
      </div>
    );
  }

  const summary = notes ? coverageSummary(notes.coverage) : null;

  return (
    <div className="crates-page">
      <header>
        <p className="crates-hint">
          <Link href="/crates">Your crates</Link>
        </p>
        <h1>{crate.title?.trim() || "Untitled crate"}</h1>
        <p className="crates-lede">
          {items.length} {items.length === 1 ? "line" : "lines"} ·{" "}
          {crate.status === "saved" ? "Saved" : "Draft"}
          {dirty ? " · Unsaved changes" : ""}
        </p>
      </header>

      {summary ? (
        <section
          className={`crates-banner ${summary.complete ? "" : "crates-banner--short"}`}
          aria-label="How well your request was matched"
        >
          <strong>{summary.headline}</strong>
          {summary.gaps.length > 0 ? (
            <>
              <p>What held lines back:</p>
              <ul>
                {summary.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
              <p className="crates-hint">
                Remove or loosen a filter below and build a new crate to see more.
              </p>
            </>
          ) : null}
          {notes && notes.unparsed.length > 0 ? (
            <>
              <p>We could not turn these parts of your request into filters:</p>
              <ul>
                {notes.unparsed.map((phrase) => (
                  <li key={phrase}>&ldquo;{phrase}&rdquo;</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="crates-panel" aria-labelledby="crate-filters-heading">
        <h2 id="crate-filters-heading">Filters</h2>
        {chips.length > 0 ? (
          <ul className="crates-chips">
            {chips.map((chip) => (
              <li key={chip.key} className="crates-chip">
                <span>{chip.label}</span>
                <button
                  type="button"
                  aria-label={`Remove filter ${chip.label}`}
                  onClick={() => setFilters((current) => (current ? removeChip(current, chip.key) : current))}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="crates-hint">No filters: every available track is a candidate.</p>
        )}
        <div className="crates-row crates-row--fields">
          <div className="crates-field">
            <label htmlFor="crate-bpm-min">Lowest BPM</label>
            <input
              id="crate-bpm-min"
              className="crates-number"
              type="number"
              min={0}
              value={filters.bpm?.min ?? ""}
              onChange={(event) =>
                setFilters((current) =>
                  current
                    ? withBpmRange(current, parseOptionalNumber(event.target.value), current.bpm?.max ?? null)
                    : current,
                )
              }
            />
          </div>
          <div className="crates-field">
            <label htmlFor="crate-bpm-max">Highest BPM</label>
            <input
              id="crate-bpm-max"
              className="crates-number"
              type="number"
              min={0}
              value={filters.bpm?.max ?? ""}
              onChange={(event) =>
                setFilters((current) =>
                  current
                    ? withBpmRange(current, current.bpm?.min ?? null, parseOptionalNumber(event.target.value))
                    : current,
                )
              }
            />
          </div>
          <div className="crates-field">
            <label htmlFor="crate-count">Lines</label>
            <input
              id="crate-count"
              className="crates-number"
              type="number"
              min={CRATE_MIN_COUNT}
              max={CRATE_MAX_COUNT}
              value={filters.count}
              onChange={(event) =>
                setFilters((current) =>
                  current ? { ...current, count: Number(event.target.value) || current.count } : current,
                )
              }
            />
          </div>
          <button
            type="button"
            className="crates-btn crates-btn--primary"
            onClick={() => void onRebuild()}
            disabled={busy || !filtersChanged}
          >
            Build a new crate with these filters
          </button>
        </div>
        <p className="crates-hint">
          Changing filters builds a separate new crate. This one stays in your list as it is.
        </p>
      </section>

      <section className="crates-panel" aria-labelledby="crate-title-heading">
        <h2 id="crate-title-heading" className="crates-sr-only">
          Title and saving
        </h2>
        <div className="crates-row crates-row--fields">
          <div className="crates-field">
            <label htmlFor="crate-title">Crate title</label>
            <input
              id="crate-title"
              className="crates-title-input"
              type="text"
              value={title}
              maxLength={CRATE_TITLE_MAX_LENGTH}
              placeholder="Untitled crate"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="crates-btn crates-btn--primary"
            onClick={() => void onSave()}
            disabled={busy || (crate.status === "saved" && !dirty)}
          >
            {crate.status === "saved" && !dirty ? "Saved" : "Save crate"}
          </button>
        </div>
      </section>

      <section aria-labelledby="crate-lines-heading" className="crates-panel">
        <h2 id="crate-lines-heading">Your set</h2>
        {items.length === 0 ? (
          <p className="crates-hint">
            This crate has no lines. Loosen a filter above and build a new crate.
          </p>
        ) : (
          <ol className="crates-lines">
            {items.map((item, index) => {
              const next = items[index + 1];
              const previewable = Boolean(
                next && item.available && next.available && item.originalStemId && next.originalStemId,
              );
              const previewState: TransitionPreviewState | undefined = previewable
                ? preview?.trackId === item.trackId
                  ? preview.state
                  : "idle"
                : undefined;
              return (
                <CrateLine
                  key={item.trackId}
                  item={item}
                  index={index}
                  busy={busy}
                  canMoveUp={canMoveLine(items, index, -1)}
                  canMoveDown={canMoveLine(items, index, 1)}
                  nextTitle={next?.title ?? null}
                  transition={next ? transitionFacts(item, next) : null}
                  previewState={previewState}
                  onMove={(direction) => onMove(index, direction)}
                  onToggleLock={() => setItems((current) => toggleLock(current, item.trackId))}
                  onSwap={() => void onSwap(item)}
                  onRemove={() => setRemoveTarget(item)}
                  onPreviewTransition={() => void onPreview(index)}
                />
              );
            })}
          </ol>
        )}
        <p className="crates-hint">
          Prices here are indicative; the quote below sets the final price.
        </p>
      </section>

      <CrateQuotePanel
        crateId={crate.id}
        items={crate.items}
        latestQuote={latestQuote}
        hasUnsavedChanges={dirty}
        onPurchaseFinished={() => void refreshAfterPurchase()}
      />

      <ConfirmDialog
        isOpen={removeTarget !== null}
        title="Remove this line?"
        message={`"${removeTarget?.title ?? ""}" leaves this crate when you save.`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={onConfirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}

export default function CrateDetailPage() {
  const params = useParams<{ id: string }>();
  const crateId = typeof params?.id === "string" ? params.id : "";
  return (
    <AuthGate title="Connect your wallet to open your crate.">
      {crateId ? <CrateEditor key={crateId} crateId={crateId} /> : null}
    </AuthGate>
  );
}
