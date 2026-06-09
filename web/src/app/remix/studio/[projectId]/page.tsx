"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../components/auth/AuthProvider";
import {
  classifyProjectLoadError,
  RemixStudioEditor,
} from "../../../../components/remix/RemixStudioEditor";
import { getRemixProject, type RemixProject } from "../../../../lib/api";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "loaded"; project: RemixProject };

/**
 * Remix Studio page shell (#894/#895): auth gate, project loading, and
 * friendly 403/404 states around the RemixStudioEditor.
 */
export default function RemixStudioPage() {
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
        setState({ kind: classifyProjectLoadError(message) });
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

  return <RemixStudioEditor project={state.project} />;
}
