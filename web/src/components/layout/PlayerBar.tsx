export default function PlayerBar() {
  return (
    <div className="app-player">
      <div>
        <strong>Now Playing</strong>
        <div style={{ color: "var(--color-muted)" }}>No track selected</div>
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        <button className="ui-btn ui-btn-ghost">Prev</button>
        <button className="ui-btn ui-btn-primary">Play</button>
        <button className="ui-btn ui-btn-ghost">Next</button>
      </div>
    </div>
  );
}
