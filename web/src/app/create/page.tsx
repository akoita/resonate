"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { SurfaceGate } from "../../components/system/SurfaceGate";

// Dynamically import the create page content with ssr: false to prevent
// Next.js from preloading create.css on unrelated pages (homepage, release, etc.)
const CreatePageContent = dynamic(() => import("./CreatePageContent"), {
  ssr: false,
});

/** Shown when the deployment switches AI generation off (#2658). */
function CreateUnavailable() {
  return (
    <main className="create-unavailable" role="status" style={{ padding: "48px 24px", maxWidth: 640 }}>
      <h1>AI creation is not offered here</h1>
      <p>
        This version of Resonate does not generate music with AI. Remix Studio still mixes and
        arranges licensed stems by hand.
      </p>
      <p>
        <Link href="/">Back to Home</Link>
      </p>
    </main>
  );
}

export default function CreatePage() {
  return (
    <SurfaceGate surface="aiGeneration" fallback={<CreateUnavailable />}>
      <CreatePageContent />
    </SurfaceGate>
  );
}
