"use client";

/**
 * Artist pickers for the upload/publish studio.
 *
 * Artist credit fields used to be plain free-text inputs. Because the backend
 * resolves a credit name to an existing profile only by an exact
 * (case-insensitive) match — and otherwise silently mints a brand-new
 * `public_artist` — a typo or a casing/spacing difference created a *different*
 * artist by mistake. These components surface existing artists as you type so
 * the canonical spelling gets reused, and make creating a genuinely new artist
 * an explicit, deliberate action.
 *
 * - `ArtistAutocomplete` — single value (Primary artist, Track artist).
 * - `ArtistTagInput` — multiple values as chips (Featured artists). Emits a
 *   comma-separated string so the existing publish payload is unchanged.
 *
 * Both are free-solo: a name that does not exist yet can always be typed and
 * added. They degrade gracefully — if the search request fails, the field still
 * behaves like a normal text input.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { searchArtists, type ArtistSearchResult } from "../../lib/api";

type SuggestOption =
  | { kind: "artist"; artist: ArtistSearchResult }
  | { kind: "create"; name: string };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Debounced search against the artist typeahead endpoint.
 *
 * `results`/`loading` are derived from a single fetch-result state keyed by the
 * query it answered, so the effect only ever calls setState asynchronously (in
 * the debounced callback) — never synchronously in its body.
 */
function useArtistSearch(
  token: string | null | undefined,
  query: string,
  enabled: boolean,
) {
  const q = query.trim();
  const shouldSearch = enabled && q.length >= 1;
  const [fetched, setFetched] = useState<{ key: string; results: ArtistSearchResult[] }>({
    key: "",
    results: [],
  });

  useEffect(() => {
    if (!shouldSearch) return;
    let active = true;
    const handle = setTimeout(async () => {
      const res = await searchArtists(token, q, 8);
      if (active) setFetched({ key: q, results: res });
    }, 200);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [token, q, shouldSearch]);

  if (!shouldSearch) return { results: [] as ArtistSearchResult[], loading: false };
  const ready = fetched.key === q;
  return { results: ready ? fetched.results : [], loading: !ready };
}

type ArtistSuggestInputProps = {
  token: string | null | undefined;
  query: string;
  onQueryChange: (value: string) => void;
  /** Called when the user commits a choice (a suggestion, or the typed value). */
  onPick: (name: string, artist: ArtistSearchResult | null) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  inputClassName?: string;
  /** Names already chosen elsewhere (e.g. existing chips) — hidden from results. */
  excludeNames?: string[];
  allowCreateRow?: boolean;
  /** Fired on Backspace when the input is empty (chip removal for the tag input). */
  onBackspaceEmpty?: () => void;
};

/**
 * The shared combobox: a text input plus a keyboard-navigable suggestion list.
 * Implements the ARIA combobox pattern.
 */
function ArtistSuggestInput({
  token,
  query,
  onQueryChange,
  onPick,
  placeholder,
  id,
  name,
  ariaLabel,
  inputClassName,
  excludeNames,
  allowCreateRow = true,
  onBackspaceEmpty,
}: ArtistSuggestInputProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  // Reset the explicit highlight when the query changes, using the
  // adjust-state-during-render pattern instead of an effect.
  const [highlightQuery, setHighlightQuery] = useState(query);
  const blurTimer = useRef<number | null>(null);
  const listId = useId();

  if (highlightQuery !== query) {
    setHighlightQuery(query);
    setHighlight(-1);
  }

  const { results, loading } = useArtistSearch(token, query, open);
  const trimmed = query.trim();
  const lowerTrimmed = trimmed.toLowerCase();

  const excluded = useMemo(
    () => new Set((excludeNames ?? []).map((n) => n.trim().toLowerCase())),
    [excludeNames],
  );

  const suggestions = useMemo(
    () => results.filter((a) => !excluded.has(a.displayName.trim().toLowerCase())),
    [results, excluded],
  );

  const hasExact = suggestions.some(
    (a) => a.displayName.trim().toLowerCase() === lowerTrimmed,
  );
  const showCreate = allowCreateRow && trimmed.length > 0 && !hasExact;

  const options: SuggestOption[] = useMemo(
    () => [
      ...suggestions.map((artist) => ({ kind: "artist", artist }) as SuggestOption),
      ...(showCreate ? [{ kind: "create", name: trimmed } as SuggestOption] : []),
    ],
    [suggestions, showCreate, trimmed],
  );

  const dropdownOpen = open && trimmed.length > 0 && options.length > 0;

  // When no row has been explicitly highlighted, Enter targets the safest
  // reuse-or-create row: an exact existing match first, otherwise "create new".
  const defaultIndex = useMemo(() => {
    const exactIdx = options.findIndex(
      (o) => o.kind === "artist" && o.artist.displayName.trim().toLowerCase() === lowerTrimmed,
    );
    if (exactIdx >= 0) return exactIdx;
    const createIdx = options.findIndex((o) => o.kind === "create");
    if (createIdx >= 0) return createIdx;
    return options.length ? 0 : -1;
  }, [options, lowerTrimmed]);

  const effectiveHighlight = highlight >= 0 ? Math.min(highlight, options.length - 1) : defaultIndex;

  useEffect(() => () => {
    if (blurTimer.current) window.clearTimeout(blurTimer.current);
  }, []);

  function selectOption(opt: SuggestOption | undefined) {
    if (!opt) return;
    if (opt.kind === "artist") onPick(opt.artist.displayName, opt.artist);
    else onPick(opt.name, null);
    setOpen(false);
    setHighlight(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min((h < 0 ? defaultIndex : h) + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max((h < 0 ? defaultIndex : h) - 1, 0));
    } else if (e.key === "Enter") {
      if (trimmed.length === 0) return;
      e.preventDefault();
      if (dropdownOpen && effectiveHighlight >= 0) {
        selectOption(options[effectiveHighlight]);
      } else {
        const exact = suggestions.find(
          (a) => a.displayName.trim().toLowerCase() === lowerTrimmed,
        );
        onPick(exact ? exact.displayName : trimmed, exact ?? null);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && query.length === 0 && onBackspaceEmpty) {
      onBackspaceEmpty();
    }
  }

  return (
    <>
      <input
        className={inputClassName ?? "ui-input"}
        value={query}
        placeholder={placeholder}
        id={id}
        name={name}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={dropdownOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          dropdownOpen && effectiveHighlight >= 0 ? `${listId}-opt-${effectiveHighlight}` : undefined
        }
        autoComplete="off"
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
      />
      {dropdownOpen && (
        <ul className="artist-suggest__dropdown" role="listbox" id={listId}>
          {options.map((opt, i) => {
            const active = i === effectiveHighlight;
            const optionClass = `artist-suggest__option${active ? " artist-suggest__option--active" : ""}`;
            if (opt.kind === "artist") {
              const a = opt.artist;
              return (
                <li
                  key={a.id}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={active}
                  className={optionClass}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                >
                  <span className="artist-suggest__avatar" aria-hidden>
                    {a.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.imageUrl} alt="" />
                    ) : (
                      initialsOf(a.displayName)
                    )}
                  </span>
                  <span className="artist-suggest__name">{a.displayName}</span>
                  {a.claimStatus === "unclaimed" && (
                    <span className="artist-suggest__badge">Unclaimed</span>
                  )}
                </li>
              );
            }
            return (
              <li
                key="__create"
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={active}
                className={`${optionClass} artist-suggest__create`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(opt);
                }}
              >
                <span className="artist-suggest__avatar artist-suggest__avatar--add" aria-hidden>
                  +
                </span>
                <span className="artist-suggest__name">
                  Add new artist <strong>“{opt.name}”</strong>
                </span>
              </li>
            );
          })}
          {loading && (
            <li className="artist-suggest__status" aria-hidden>
              Searching…
            </li>
          )}
        </ul>
      )}
    </>
  );
}

type ArtistAutocompleteProps = {
  token: string | null | undefined;
  value: string;
  onChange: (value: string, artist?: ArtistSearchResult | null) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
};

/** Single-artist field with reuse-vs-create guidance. */
export function ArtistAutocomplete({
  token,
  value,
  onChange,
  placeholder,
  id,
  name,
  ariaLabel,
}: ArtistAutocompleteProps) {
  const [picked, setPicked] = useState<ArtistSearchResult | null>(null);
  const matchesPicked =
    !!picked && picked.displayName.trim().toLowerCase() === value.trim().toLowerCase();
  const effectivePicked = matchesPicked ? picked : null;

  return (
    <div className="artist-suggest">
      <div className="artist-suggest__field">
        <ArtistSuggestInput
          token={token}
          query={value}
          onQueryChange={(v) => onChange(v, null)}
          onPick={(pickedName, artist) => {
            setPicked(artist);
            onChange(pickedName, artist);
          }}
          placeholder={placeholder}
          id={id}
          name={name}
          ariaLabel={ariaLabel}
        />
      </div>
      {value.trim().length > 0 &&
        (effectivePicked ? (
          <span className="artist-suggest__hint artist-suggest__hint--existing">
            ✓ Linked to existing artist “{effectivePicked.displayName}”
          </span>
        ) : (
          <span className="artist-suggest__hint">
            Pick a match from the list to reuse an existing artist, or keep typing to create a new one.
          </span>
        ))}
    </div>
  );
}

type ArtistTagInputProps = {
  token: string | null | undefined;
  /** Comma-separated names — kept as a string for payload compatibility. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
};

/** Multi-artist chip field (Featured artists). */
export function ArtistTagInput({
  token,
  value,
  onChange,
  placeholder,
  id,
  ariaLabel,
}: ArtistTagInputProps) {
  const tags = useMemo(
    () => value.split(",").map((s) => s.trim()).filter(Boolean),
    [value],
  );
  const [query, setQuery] = useState("");

  function commit(next: string[]) {
    const seen = new Set<string>();
    const deduped = next.filter((n) => {
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    onChange(deduped.join(", "));
  }

  function addTags(names: string[]) {
    const merged = [...tags];
    for (const raw of names) {
      const t = raw.trim();
      if (!t) continue;
      if (!merged.some((m) => m.toLowerCase() === t.toLowerCase())) merged.push(t);
    }
    commit(merged);
  }

  function removeTag(index: number) {
    commit(tags.filter((_, i) => i !== index));
  }

  // Treat commas as separators even mid-type (handles pasted "A, B, C").
  function handleQueryChange(v: string) {
    if (v.includes(",")) {
      const parts = v.split(",");
      const last = parts.pop() ?? "";
      addTags(parts);
      setQuery(last.replace(/^\s+/, ""));
    } else {
      setQuery(v);
    }
  }

  return (
    <div className="artist-suggest">
      <div className="artist-tags">
        {tags.map((tag, i) => (
          <span key={`${tag}-${i}`} className="artist-tag">
            {tag}
            <button
              type="button"
              className="artist-tag__remove"
              aria-label={`Remove ${tag}`}
              onClick={() => removeTag(i)}
            >
              ×
            </button>
          </span>
        ))}
        <div className="artist-tags__field-wrap">
          <ArtistSuggestInput
            token={token}
            query={query}
            onQueryChange={handleQueryChange}
            onPick={(pickedName) => {
              addTags([pickedName]);
              setQuery("");
            }}
            placeholder={tags.length ? "" : placeholder}
            id={id}
            ariaLabel={ariaLabel}
            excludeNames={tags}
            inputClassName="artist-tags__field"
            onBackspaceEmpty={() => {
              if (tags.length) removeTag(tags.length - 1);
            }}
          />
        </div>
      </div>
      <span className="artist-suggest__hint">
        Pick existing artists from the list to avoid duplicates. Press Enter or comma to add.
      </span>
    </div>
  );
}
