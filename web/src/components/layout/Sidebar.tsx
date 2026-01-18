export default function Sidebar() {
  return (
    <aside className="app-sidebar">
      <h2>Resonate</h2>
      <nav style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
        <a href="/">Home</a>
        <a href="/player">Player</a>
        <a href="/artist/upload">Upload</a>
        <a href="/artist/analytics">Analytics</a>
      </nav>
    </aside>
  );
}
