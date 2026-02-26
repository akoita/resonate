"use client";

import dynamic from "next/dynamic";

// Dynamically import the create page content with ssr: false to prevent
// Next.js from preloading create.css on unrelated pages (homepage, release, etc.)
const CreatePageContent = dynamic(() => import("./CreatePageContent"), {
  ssr: false,
});

export default function CreatePage() {
  return <CreatePageContent />;
}
