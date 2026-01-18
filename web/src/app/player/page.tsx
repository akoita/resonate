import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

const queue = [
  { name: "Neon Drift", artist: "Aya Lune", duration: "3:42" },
  { name: "Satellite", artist: "Kiro", duration: "4:01" },
  { name: "Glass City", artist: "Mira", duration: "2:58" },
  { name: "Echo Lane", artist: "Sola", duration: "3:21" },
];

export default function PlayerPage() {
  return (
    <main className="player-grid">
      <Card>
        <div className="player-art" />
        <h2 style={{ marginTop: "16px" }}>Neon Drift</h2>
        <div className="player-meta">Aya Lune · 3:42 · Mood: Night Drive</div>
        <div className="player-controls">
          <Button variant="ghost">Prev</Button>
          <Button>Play</Button>
          <Button variant="ghost">Next</Button>
        </div>
      </Card>

      <Card title="Queue">
        <div className="queue-list">
          {queue.map((track) => (
            <div key={track.name} className="queue-item">
              <div>
                <div>{track.name}</div>
                <div className="queue-meta">{track.artist}</div>
              </div>
              <div className="queue-meta">{track.duration}</div>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}
