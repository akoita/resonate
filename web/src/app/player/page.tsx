import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

const queue = [
  { name: "Neon Drift", artist: "Aya Lune", duration: "3:42" },
  { name: "Satellite", artist: "Kiro", duration: "4:01" },
  { name: "Glass City", artist: "Mira", duration: "2:58" },
  { name: "Echo Lane", artist: "Sola", duration: "3:21" },
];
const currentTrack = queue[0];

export default function PlayerPage() {
  return (
    <main className="player-grid">
      <Card>
        <div className="player-art" />
        <h2 style={{ marginTop: "16px" }}>{currentTrack.name}</h2>
        <div className="player-meta">
          {currentTrack.artist} · {currentTrack.duration} · Mood: Night Drive
        </div>
        <div className="player-controls">
          <Button variant="ghost">Prev</Button>
          <Button>Play</Button>
          <Button variant="ghost">Next</Button>
        </div>
        <div className="player-progress">
          <input className="player-range" type="range" min="0" max="100" />
          <div className="player-time">
            <span>1:02</span>
            <span>{currentTrack.duration}</span>
          </div>
        </div>
        <div className="player-volume">
          <span className="queue-meta">Volume</span>
          <input className="player-range" type="range" min="0" max="100" />
        </div>
      </Card>

      <Card title="Queue">
        <div className="queue-list">
          {queue.map((track) => (
            <div
              key={track.name}
              className={`queue-item ${
                track.name === currentTrack.name ? "queue-item-active" : ""
              }`}
            >
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
