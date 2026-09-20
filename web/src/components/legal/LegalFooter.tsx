import Link from "next/link";

export function LegalFooter() {
  return (
    <footer className="legal-footer" aria-label="Legal and contact">
      <span>© {new Date().getFullYear()} Resonate</span>
      <nav aria-label="Legal links">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/refunds">Refunds</Link>
        <Link href="/imprint">Contact</Link>
      </nav>
    </footer>
  );
}
