"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AuthGate from "../../components/auth/AuthGate";
import { useAuth } from "../../components/auth/AuthProvider";
import { MarketplaceBrowse } from "../../components/marketplace/MarketplaceBrowse";
import { createCrateRequest, listCrates } from "../../lib/api";
import {
  clampCount,
  CRATE_DEFAULT_COUNT,
  CRATE_MAX_COUNT,
  CRATE_MIN_COUNT,
  CRATE_REQUEST_MAX_TEXT_LENGTH,
  crateErrorMessage,
  storeCrateCreationNotes,
  type CrateListEntry,
  type CreateCrateRequestBody,
} from "../../lib/crates";
import "../../styles/crates.css";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function CratesHome() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const referenceTrackId = searchParams.get("referenceTrackId");

  const [text, setText] = useState("");
  // Empty means "not set": the backend then uses the number in the sentence
  // ("4 tracks"), or its default. Sending a value always overrides the text.
  const [count, setCount] = useState("");
  // A reference track builds on arrival, so the page starts in the building state.
  const [building, setBuilding] = useState(referenceTrackId !== null);
  const [error, setError] = useState<string | null>(null);
  const [crates, setCrates] = useState<CrateListEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const autoSubmitted = useRef<string | null>(null);

  const build = useCallback(
    async (body: CreateCrateRequestBody, { replace = false }: { replace?: boolean } = {}) => {
      if (!token) return;
      try {
        const response = await createCrateRequest(token, body);
        storeCrateCreationNotes(response.crate.id, response);
        const href = `/crates/${encodeURIComponent(response.crate.id)}`;
        // A reference-track link builds on arrival, so it must not stay in the
        // history: Back would otherwise build another crate each time.
        if (replace) router.replace(href);
        else router.push(href);
      } catch (err) {
        setError(crateErrorMessage(err, "We could not build that crate. Please try again."));
        setBuilding(false);
      }
    },
    [router, token],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listCrates(token)
      .then((result) => {
        if (!cancelled) setCrates(result?.crates ?? []);
      })
      .catch(() => {
        if (!cancelled) setListError("We could not load your crates.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // "More like this track": build straight away, once per track id.
  useEffect(() => {
    if (!token || !referenceTrackId) return;
    if (autoSubmitted.current === referenceTrackId) return;
    autoSubmitted.current = referenceTrackId;
    createCrateRequest(token, { referenceTrackId, count: CRATE_DEFAULT_COUNT })
      .then((response) => {
        storeCrateCreationNotes(response.crate.id, response);
        router.replace(`/crates/${encodeURIComponent(response.crate.id)}`);
      })
      .catch((err) => {
        setError(crateErrorMessage(err, "We could not build that crate. Please try again."));
        setBuilding(false);
      });
  }, [referenceTrackId, router, token]);

  const trimmed = text.trim();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed || building) return;
    setBuilding(true);
    setError(null);
    const lines = count.trim() === "" ? Number.NaN : Number(count);
    void build(Number.isFinite(lines) ? { text: trimmed, count: clampCount(lines) } : { text: trimmed });
  };

  return (
    <div className="crates-tab-content">
      {referenceTrackId ? (
        <header>
          <h2>More like this track</h2>
          <p className="crates-lede">
            Building a crate of tracks that sit close to the one you chose.
          </p>
        </header>
      ) : (
        <p className="crates-lede">
          Say what your set needs. You get a crate you can reorder, lock, swap and save.
        </p>
      )}

      {referenceTrackId ? (
        <div className="crates-panel" aria-live="polite">
          {building ? <p>Building your crate…</p> : null}
          {error ? (
            <>
              <p className="crates-error" role="alert">
                {error}
              </p>
              <div className="crates-row">
                <button
                  type="button"
                  className="crates-btn crates-btn--primary"
                  onClick={() => {
                    setBuilding(true);
                    setError(null);
                    void build({ referenceTrackId, count: CRATE_DEFAULT_COUNT }, { replace: true });
                  }}
                >
                  Try again
                </button>
                <Link className="crates-btn" href="/crates">
                  Describe a crate instead
                </Link>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <form className="crates-panel" onSubmit={onSubmit}>
          <div className="crates-field">
            <label htmlFor="crate-request-text">What does your set need?</label>
            <textarea
              id="crate-request-text"
              className="crates-textarea"
              value={text}
              maxLength={CRATE_REQUEST_MAX_TEXT_LENGTH}
              onChange={(event) => setText(event.target.value)}
              placeholder="Eight melodic house tracks around 122-126 BPM in 8A or 9A, with vocals stems, under $20 each"
              aria-describedby="crate-request-hint"
            />
            <p id="crate-request-hint" className="crates-hint">
              Tempo, key, energy, genre, mood, stems, license and budget all work. Up to{" "}
              {CRATE_REQUEST_MAX_TEXT_LENGTH} characters; anything we cannot read is shown back to
              you. Leave Lines empty to use the number in your sentence.
            </p>
          </div>
          <div className="crates-row crates-row--fields">
            <div className="crates-field">
              <label htmlFor="crate-request-count">Lines</label>
              <input
                id="crate-request-count"
                className="crates-number"
                type="number"
                inputMode="numeric"
                min={CRATE_MIN_COUNT}
                max={CRATE_MAX_COUNT}
                placeholder={String(CRATE_DEFAULT_COUNT)}
                aria-describedby="crate-request-hint"
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            </div>
            <button
              type="submit"
              className="crates-btn crates-btn--primary"
              disabled={!trimmed || building}
            >
              {building ? "Building…" : "Build crate"}
            </button>
          </div>
          {error ? (
            <p className="crates-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}

      <section aria-labelledby="your-crates-heading" className="crates-panel">
        <h2 id="your-crates-heading">Your crates</h2>
        {listError ? (
          <p className="crates-error" role="alert">
            {listError}
          </p>
        ) : crates === null ? (
          <p className="crates-hint">Loading your crates…</p>
        ) : crates.length === 0 ? (
          <p className="crates-hint">No crates yet. Describe a set above to build your first one.</p>
        ) : (
          <ul className="crates-list">
            {crates.map((crate) => (
              <li key={crate.id}>
                <Link className="crates-list-link" href={`/crates/${encodeURIComponent(crate.id)}`}>
                  <span>{crate.title?.trim() || "Untitled crate"}</span>
                  <span className="crates-hint">
                    {crate.itemCount} {crate.itemCount === 1 ? "line" : "lines"} ·{" "}
                    {crate.status === "saved" ? "Saved" : "Draft"} · {formatDate(crate.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type CratesTab = "build" | "stems";

const TABS: ReadonlyArray<{ id: CratesTab; label: string }> = [
  { id: "build", label: "Build a crate" },
  { id: "stems", label: "Browse stems" },
];

function CratesAndStems() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabRefs = useRef<Record<CratesTab, HTMLButtonElement | null>>({ build: null, stems: null });
  // A reference track builds on arrival, so it always means the build tab.
  const tab: CratesTab =
    searchParams.get("referenceTrackId") === null && searchParams.get("tab") === "stems"
      ? "stems"
      : "build";

  const selectTab = useCallback(
    (next: CratesTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "stems") {
        params.set("tab", "stems");
        // Leaving the build tab abandons the reference-track arrival.
        params.delete("referenceTrackId");
      } else {
        params.delete("tab");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = TABS[nextIndex].id;
    selectTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={`crates-page${tab === "stems" ? " crates-page--wide" : ""}`}>
      <header>
        <h1>Crates &amp; Stems</h1>
        <p className="crates-lede">
          Build a crate from a sentence, or browse stems to license on their own.
        </p>
      </header>

      <div className="crates-tabs" role="tablist" aria-label="Crates and stems">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[item.id] = node;
            }}
            type="button"
            role="tab"
            id={`crates-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`crates-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className="crates-tab"
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`crates-panel-${tab}`}
        aria-labelledby={`crates-tab-${tab}`}
        className="crates-tabpanel"
      >
        {tab === "stems" ? (
          <MarketplaceBrowse headingLevel={2} />
        ) : (
          <AuthGate title="Connect your wallet to build a crate.">
            <CratesHome />
          </AuthGate>
        )}
      </div>
    </div>
  );
}

export default function CratesPage() {
  return (
    <Suspense fallback={<div className="crates-page">Loading…</div>}>
      <CratesAndStems />
    </Suspense>
  );
}
