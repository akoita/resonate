export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr" }}>
      <aside style={{ background: "var(--color-surface)", padding: "24px" }}>
        <h2>Resonate</h2>
        <nav>
          <a href="/">Home</a>
          <br />
          <a href="/artist/upload">Upload</a>
          <br />
          <a href="/artist/analytics">Analytics</a>
        </nav>
      </aside>
      <div style={{ padding: "24px" }}>{children}</div>
    </div>
  );
}
