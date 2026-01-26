import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="app-sidebar">
      <h2>Resonate</h2>
      <nav style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
        <Link href="/">Home</Link>
        <Link href="/player">Player</Link>
        <Link href="/library">Library</Link>
        <Link href="/artist/upload">Upload</Link>
        <Link href="/artist/analytics">Analytics</Link>
        <Link href="/wallet">Wallet</Link>
      </nav>
    </aside>
  );
}
