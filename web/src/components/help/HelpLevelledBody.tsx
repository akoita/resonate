"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, Ref } from "react";

import {
  HELP_LEVEL_PARAM,
  HELP_LEVEL_STORAGE_KEY,
  articleLevels,
  defaultLevelFor,
  helpLevelLabel,
  levelForKey,
  nextHelpLevel,
  resolveHelpLevel,
  sectionsForLevel,
} from "../../lib/help/levels";
import type { HelpLevel, HelpLevelIntro, HelpSection } from "../../lib/help/types";
import { HelpSectionView, HelpToc } from "./HelpSectionView";

/**
 * Beginner / Intermediate / Professional switch for a levelled article
 * (#1905), following the WAI-ARIA tabs pattern: arrow keys, Home and End move
 * between tabs and select them, only the selected tab is in the tab order,
 * and the panel is labelled by its tab.
 *
 * The server renders the default level, so the page stays readable without
 * JavaScript. After mount the level comes from the URL (`#section` of a
 * levelled section, then `?level=`), then this viewer's stored choice. Every
 * switch writes `?level=` back to the URL, so the address bar is always a
 * shareable link to what is on screen.
 */

export const HELP_LEVEL_TAB_ID = (level: HelpLevel) => `help-level-tab-${level}`;
export const HELP_LEVEL_PANEL_ID = "help-level-panel";

export interface HelpLevelledBodyProps {
  sections: HelpSection[];
  intros: Partial<Record<HelpLevel, HelpLevelIntro>>;
}

function readStoredLevel(): string | null {
  try {
    return window.localStorage.getItem(HELP_LEVEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLevel(level: HelpLevel): void {
  try {
    window.localStorage.setItem(HELP_LEVEL_STORAGE_KEY, level);
  } catch {
    // Private mode or storage disabled: the URL still carries the level.
  }
}

/** The article URL for `level`, dropping an anchor that may now be hidden. */
export function urlWithLevel(href: string, level: HelpLevel): string {
  const url = new URL(href);
  url.searchParams.set(HELP_LEVEL_PARAM, level);
  url.hash = "";
  return url.toString();
}

export function HelpLevelledBody({ sections, intros }: HelpLevelledBodyProps) {
  const levels = useMemo(() => articleLevels({ sections }), [sections]);
  const [level, setLevel] = useState<HelpLevel>(() => defaultLevelFor(levels));
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  const tabRefs = useRef<Partial<Record<HelpLevel, HTMLButtonElement | null>>>({});
  const tablistRef = useRef<HTMLDivElement | null>(null);
  // Scroll work to do after the next level renders.
  const pendingScroll = useRef<
    { kind: "keep"; top: number } | { kind: "tablist" } | { kind: "hash"; id: string } | null
  >(null);

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash;
      const next = resolveHelpLevel({
        sections,
        param: new URLSearchParams(window.location.search).get(HELP_LEVEL_PARAM),
        hash,
        stored: readStoredLevel(),
      });
      if (next === levelRef.current) return;
      // The browser could not scroll to an anchor that wasn't rendered yet.
      pendingScroll.current = hash.length > 1 ? { kind: "hash", id: hash.slice(1) } : null;
      levelRef.current = next;
      setLevel(next);
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, [sections]);

  useLayoutEffect(() => {
    const pending = pendingScroll.current;
    pendingScroll.current = null;
    if (!pending) return;
    if (pending.kind === "keep") {
      // Keep the switch where the reader's eyes are; only a shorter page can
      // move it (the browser clamps the scroll).
      const top = tablistRef.current?.getBoundingClientRect().top;
      if (top !== undefined) window.scrollBy(0, top - pending.top);
    } else if (pending.kind === "tablist") {
      tablistRef.current?.scrollIntoView({ block: "start" });
    } else {
      document.getElementById(pending.id)?.scrollIntoView({ block: "start" });
    }
  }, [level]);

  const select = (next: HelpLevel, options: { focus: boolean; scroll: "keep" | "tablist" }) => {
    if (options.focus) tabRefs.current[next]?.focus({ preventScroll: true });
    if (next === levelRef.current) return;
    if (options.scroll === "keep") {
      const top = tablistRef.current?.getBoundingClientRect().top;
      pendingScroll.current = top === undefined ? null : { kind: "keep", top };
    } else {
      pendingScroll.current = { kind: "tablist" };
    }
    levelRef.current = next;
    setLevel(next);
    storeLevel(next);
    // Next.js syncs its router with the native History API.
    window.history.replaceState(null, "", urlWithLevel(window.location.href, next));
  };

  return (
    <HelpLevelledView
      level={level}
      levels={levels}
      sections={sections}
      intros={intros}
      tablistRef={tablistRef}
      tabRef={(tabLevel, element) => {
        tabRefs.current[tabLevel] = element;
      }}
      onSelect={(next) => select(next, { focus: false, scroll: "keep" })}
      onTabKeyDown={(event) => {
        const next = levelForKey(event.key, level, levels);
        if (!next) return;
        event.preventDefault();
        select(next, { focus: true, scroll: "keep" });
      }}
      onNext={(next, event) => {
        event.preventDefault();
        select(next, { focus: true, scroll: "tablist" });
      }}
    />
  );
}

export interface HelpLevelledViewProps extends HelpLevelledBodyProps {
  level: HelpLevel;
  levels: readonly HelpLevel[];
  tablistRef?: Ref<HTMLDivElement>;
  tabRef?(level: HelpLevel, element: HTMLButtonElement | null): void;
  onSelect?(level: HelpLevel): void;
  onTabKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
  onNext?(level: HelpLevel, event: MouseEvent<HTMLAnchorElement>): void;
}

/** Hook-free markup of the switch and the selected level's panel. */
export function HelpLevelledView({
  level,
  levels,
  sections,
  intros,
  tablistRef,
  tabRef,
  onSelect,
  onTabKeyDown,
  onNext,
}: HelpLevelledViewProps) {
  const shown = sectionsForLevel(sections, level);
  const intro = intros[level];
  const next = nextHelpLevel(levels, level);
  const nextIntro = next ? intros[next] : undefined;
  // "Ready for more?" follows the level's own last section, before the
  // sections every level shares (such as the glossary).
  const lastOwnIndex = shown.reduce(
    (last, section, index) => (section.level === level ? index : last),
    -1,
  );

  return (
    <div className="help-levels">
      <div className="help-levels__bar">
        <p className="help-levels__label" id="help-levels-label">
          Choose your level
        </p>
        <div
          ref={tablistRef}
          role="tablist"
          aria-labelledby="help-levels-label"
          className="help-levels__tabs"
        >
          {levels.map((tabLevel) => {
            const selected = tabLevel === level;
            return (
              <button
                key={tabLevel}
                ref={(element) => tabRef?.(tabLevel, element)}
                type="button"
                role="tab"
                id={HELP_LEVEL_TAB_ID(tabLevel)}
                aria-selected={selected}
                aria-controls={HELP_LEVEL_PANEL_ID}
                tabIndex={selected ? 0 : -1}
                className={`help-levels__tab${selected ? " is-selected" : ""}`}
                onClick={() => onSelect?.(tabLevel)}
                onKeyDown={onTabKeyDown}
              >
                <span className="help-levels__tab-label">{helpLevelLabel(tabLevel)}</span>
                {intros[tabLevel] ? (
                  <span className="help-levels__tab-sub" aria-hidden="true">
                    {intros[tabLevel]!.title}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={HELP_LEVEL_PANEL_ID}
        aria-labelledby={HELP_LEVEL_TAB_ID(level)}
        tabIndex={0}
        className="help-levels__panel"
        data-level={level}
      >
        {intro ? (
          <div className="help-level-intro">
            <p className="help-level-intro__title">{intro.title}</p>
            <p className="help-level-intro__summary">{intro.summary}</p>
          </div>
        ) : null}

        <HelpToc sections={shown} />

        <div className="help-article__body">
          {shown.map((section, index) => (
            <Fragment key={section.id}>
              <HelpSectionView section={section} />
              {index === lastOwnIndex && next ? (
                <nav className="help-level-next" aria-label="Next level">
                  <p className="help-level-next__title">Ready for more?</p>
                  {nextIntro ? (
                    <p className="help-level-next__text">{nextIntro.summary}</p>
                  ) : null}
                  <a
                    className="help-level-next__link"
                    href={`?${HELP_LEVEL_PARAM}=${next}`}
                    onClick={(event) => onNext?.(next, event)}
                  >
                    Continue with {helpLevelLabel(next)}
                    {nextIntro ? `: ${nextIntro.title}` : ""}
                    <span aria-hidden="true"> →</span>
                  </a>
                </nav>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
