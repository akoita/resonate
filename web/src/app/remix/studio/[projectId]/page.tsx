"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../components/auth/AuthProvider";
import { getRemixProject, type RemixProject } from "../../../../lib/api";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "loaded"; project: RemixProject };

/**
 * Minimal Remix Studio destination (#894). Read-only by design: it proves the
 * CTA → project flow end to end. The full studio (stem controls, prompts,
 * generation) ships with #895 and replaces this page body.
 */
export default function RemixStudioStubPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { token, login } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    // The signed-out state is derived at render time from the auth token.
    if (!projectId || !token) return;
    let cancelled = false;
    getRemixProject(token, projectId)
      .then((project) => {
        if (!cancelled) setState({ kind: "loaded", project });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith("API 403:")) {
          setState({ kind: "forbidden" });
        } else if (message.startsWith("API 404:")) {
          setState({ kind: "missing" });
        } else {
          setState({ kind: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, projectId]);

  if (!token) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-bold text-white mb-2">
            Sign in to open this remix project
          </h1>
          <p className="text-zinc-400 mb-4">
            Remix projects are private drafts visible only to their creator.
          </p>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => void login?.()}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-pulse space-y-4 text-center" aria-busy="true">
          <div className="w-16 h-16 rounded-full bg-zinc-800 mx-auto" />
          <div className="h-4 bg-zinc-800 rounded w-40 mx-auto" />
        </div>
      </div>
    );
  }

  if (state.kind !== "loaded") {
    const copy =
      state.kind === "forbidden"
        ? {
            title: "This remix project is private",
            body: "Only the creator of a remix draft can open it.",
          }
        : state.kind === "missing"
          ? {
              title: "Remix project not found",
              body: "This draft may have been removed.",
            }
          : {
              title: "Could not load remix project",
              body: "Something went wrong. Please try again.",
            };
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-bold text-white mb-2">{copy.title}</h1>
          <p className="text-zinc-400 mb-4">{copy.body}</p>
          <Link href="/" className="text-emerald-500 hover:text-emerald-400">
            Back to Home →
          </Link>
        </div>
      </div>
    );
  }

  const { project } = state;

  return (
    <div className="min-h-screen bg-black">
      <div className="bg-gradient-to-b from-purple-900/20 to-transparent">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="text-sm text-zinc-400 mb-2">Remix Studio</div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-white">{project.title}</h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
              {project.status}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
              {project.mode.replace("_", " ")}
            </span>
          </div>
          <p className="text-zinc-400 mt-2 text-sm">
            Private draft — publishing and export are not available yet. Stem
            editing, prompts, and AI draft generation arrive with the full
            studio.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Source stems</h2>
          {project.stems.length === 0 ? (
            <p className="text-zinc-400 text-sm">No stems selected.</p>
          ) : (
            <ul className="space-y-2">
              {project.stems.map((stem) => (
                <li
                  key={stem.stemId}
                  className="flex items-center justify-between text-sm border border-zinc-800 rounded-md px-3 py-2"
                >
                  <span className="text-zinc-300 font-mono">{stem.stemId}</span>
                  <span className="text-zinc-500">
                    {stem.role ? `${stem.role} · ` : ""}
                    {stem.muted ? "muted" : "active"}
                    {stem.gainDb != null ? ` · ${stem.gainDb} dB` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-400">
          <div className="flex flex-wrap gap-x-8 gap-y-1">
            <span>
              License: <span className="text-zinc-300">{project.licenseType}</span>
            </span>
            <span>
              Policy: <span className="text-zinc-300">{project.policyVersion}</span>
            </span>
            <span>
              Created:{" "}
              <span className="text-zinc-300">
                {new Date(project.createdAt).toLocaleString()}
              </span>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
