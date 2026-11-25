"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_GROUP_LABELS,
  moveActive,
  normalizeQuery,
  searchEverything,
  shouldSearch,
  toSearchOptions,
  type SearchResults,
} from "../../lib/search";

type Status = "idle" | "loading" | "ready" | "error";

/** Typing "/" focuses search, unless the person is already typing somewhere. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
}

export function resultsSummary(status: Status, count: number, query: string): string {
  if (status === "loading") return "Searching…";
  if (status === "error") return "Search is not available right now. Try again in a moment.";
  if (status !== "ready") return "";
  if (count === 0) return `No results for “${query}”.`;
  return `${count} result${count === 1 ? "" : "s"}. Use the up and down arrows to move, Enter to open.`;
}

/**
 * Search in the top bar (#2671): a combobox over artists, releases, tracks
 * and public playlists. "/" or Ctrl+K (⌘K) focuses it from anywhere.
 */
export default function TopbarSearch() {
  const router = useRouter();
  const baseId = useId();
  const listboxId = `${baseId}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  // The last answer, with the query it answers; status is derived from it so
  // the effect below only sets state from its async callbacks.
  const [answer, setAnswer] = useState<{ query: string; results: SearchResults | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);

  const normalized = normalizeQuery(query);
  const searchable = shouldSearch(query);
  const status: Status = !searchable
    ? "idle"
    : answer?.query !== normalized
      ? "loading"
      : answer.results
        ? "ready"
        : "error";
  // While the next answer loads, the previous results stay up instead of flashing.
  const results = searchable && status !== "error" ? answer?.results ?? null : null;
  const groups = useMemo(() => (results ? toSearchOptions(results) : []), [results]);
  const options = useMemo(() => groups.flatMap((group) => group.options), [groups]);
  const indexByKey = useMemo(() => new Map(options.map((option, i) => [option.key, i])), [options]);
  const showPanel = open && searchable;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchEverything(normalized, controller.signal)
        .then((next) => setAnswer({ query: normalized, results: next }))
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name === "AbortError") return;
          setAnswer({ query: normalized, results: null });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, searchable]);

  const focusSearch = useCallback(() => {
    setExpanded(true);
    setOpen(true);
    // The field may only now be rendered visible on a narrow screen.
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = (event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey);
      const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target);
      if (!shortcut && !slash) return;
      event.preventDefault();
      focusSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearch]);

  const close = (clear: boolean) => {
    setOpen(false);
    setActive(-1);
    if (clear) {
      setQuery("");
      setExpanded(false);
    }
  };

  const openOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    close(true);
    inputRef.current?.blur();
    router.push(option.href);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) => moveActive(current, options.length, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      if (active >= 0) {
        event.preventDefault();
        openOption(active);
      } else if (options.length === 1) {
        event.preventDefault();
        openOption(0);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (open && query) close(false);
      else {
        close(true);
        inputRef.current?.blur();
      }
    } else if (event.key === "Home" || event.key === "End") {
      // Keep Home/End for moving the caret, as in any text field.
      setActive(-1);
    }
  };

  const activeOption = active >= 0 ? options[active] : undefined;
  const summary = resultsSummary(status, options.length, normalized);

  return (
    <div className={`topbar-search ${expanded ? "is-expanded" : ""}`}>
      <button
        type="button"
        className="topbar-search-toggle"
        aria-label="Search"
        aria-expanded={expanded}
        onClick={focusSearch}
      >
        <SearchIcon />
      </button>
      <div className="topbar-search-field">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search artists, releases, tracks and playlists"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${baseId}-${activeOption.key}` : undefined}
          aria-keyshortcuts="/ Control+K Meta+K"
          placeholder="Search"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={80}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            if (event.currentTarget.closest(".topbar-search")?.contains(event.relatedTarget as Node | null)) return;
            setOpen(false);
            if (!query) setExpanded(false);
          }}
          onKeyDown={onInputKeyDown}
        />
        <kbd className="topbar-search-hint" aria-hidden="true">/</kbd>
      </div>
      <div className="topbar-search-panel" hidden={!showPanel}>
        <ul id={listboxId} role="listbox" aria-label="Search results" className="topbar-search-results">
          {groups.map((group) => (
            <li key={group.group} role="presentation">
              <ul role="group" aria-labelledby={`${baseId}-${group.group}`}>
                <li role="presentation" id={`${baseId}-${group.group}`} className="topbar-search-group">
                  {SEARCH_GROUP_LABELS[group.group]}
                </li>
                {group.options.map((option) => {
                  const optionIndex = indexByKey.get(option.key) ?? -1;
                  return (
                    <li
                      key={option.key}
                      id={`${baseId}-${option.key}`}
                      role="option"
                      aria-selected={optionIndex === active}
                      className={`topbar-search-option ${optionIndex === active ? "is-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(optionIndex)}
                      onClick={() => openOption(optionIndex)}
                    >
                      <span className={`topbar-search-thumb topbar-search-thumb--${option.group}`} aria-hidden="true">
                        {option.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- small remote thumbnails, sized by CSS
                          <img src={option.imageUrl} alt="" loading="lazy" decoding="async" />
                        ) : (
                          option.label.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="topbar-search-text">
                        <span className="topbar-search-label">{option.label}</span>
                        <span className="topbar-search-detail">{option.detail}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {options.length === 0 ? (
          <p className="topbar-search-empty">{summary}</p>
        ) : null}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {showPanel ? summary : ""}
      </p>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.65" y2="16.65" />
    </svg>
  );
}
