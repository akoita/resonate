"use client";

import type { RemixProject } from "../../lib/api";

/** Maps apiRequest error messages ("API <status>: ...") to a load state. */
export function classifyProjectLoadError(
  message: string,
): "forbidden" | "missing" | "error" {
  if (message.startsWith("API 403:")) return "forbidden";
  if (message.startsWith("API 404:")) return "missing";
  return "error";
}

/**
 * Read-only remix project view (#894). It proves the CTA → project flow end
 * to end; the full editing studio (#895) replaces it.
 */
export function RemixStudioProjectView({ project }: { project: RemixProject }) {
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
