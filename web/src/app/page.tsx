import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

export default function Home() {
  const moods = ["Focus", "Chill", "Energy", "Night Drive", "Lo-fi"];
  const trending = ["Neon Drift", "Satellite", "Glass City", "Echo Lane"];
  const releases = ["Aurora Fields", "Parallel Bloom", "Blue Circuit", "Mirage"];
  const curated = ["Deep Flow", "Momentum", "Calm Waves", "Pulse"];

  return (
    <main>
      <section className="home-hero">
        <div className="home-title">Resonate</div>
        <div className="home-subtitle">
          Start a session, explore new artists, or upload your next release.
        </div>
        <div className="home-actions">
          <Button>Start session</Button>
          <a href="/artist/upload">
            <Button variant="ghost">Upload stems</Button>
          </a>
        </div>
        <div className="home-chips">
          {moods.map((mood) => (
            <button key={mood} className="home-chip" type="button">
              {mood}
            </button>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-title">Trending</div>
        <div className="card-grid">
          {trending.map((name) => (
            <Card key={name} title={name}>
              Plays up 12% · 3:42
            </Card>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-title">New Releases</div>
        <div className="card-grid">
          {releases.map((name) => (
            <Card key={name} title={name}>
              Fresh drop · 2:58
            </Card>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section-title">AI Curated</div>
        <div className="card-grid">
          {curated.map((name) => (
            <Card key={name} title={name}>
              Personalized mix · 4:10
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
