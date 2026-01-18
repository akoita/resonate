import AuthGate from "../../../components/auth/AuthGate";
import { Card } from "../../../components/ui/Card";

const tracks = [
  { name: "Neon Drift", plays: 4820, payout: 320.5 },
  { name: "Satellite", plays: 3910, payout: 255.0 },
  { name: "Glass City", plays: 2750, payout: 190.25 },
];

export default function ArtistAnalyticsPage() {
  return (
    <AuthGate title="Connect your wallet to view artist analytics.">
      <main style={{ display: "grid", gap: "24px" }}>
        <h1>Artist Analytics</h1>
        <div className="kpi-row">
          <Card>
            <div className="kpi">
              <div className="kpi-icon">▶</div>
              <div>
                <div className="queue-meta">Total Plays</div>
                <div>11,480</div>
                <div className="kpi-trend">+8.4% this week</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="kpi">
              <div className="kpi-icon">$</div>
              <div>
                <div className="queue-meta">Total Payout</div>
                <div>USDC 765.75</div>
                <div className="kpi-trend">+5.1% this week</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="kpi">
              <div className="kpi-icon">★</div>
              <div>
                <div className="queue-meta">Top Track</div>
                <div>Neon Drift</div>
                <div className="kpi-trend">3,120 plays</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="kpi">
              <div className="kpi-icon">+</div>
              <div>
                <div className="queue-meta">Followers</div>
                <div>3,420</div>
                <div className="kpi-trend">+120 today</div>
              </div>
            </div>
          </Card>
        </div>

        <Card title="Plays over time">
          <div className="analytics-chart analytics-chart-grid">
            <div className="analytics-line" />
          </div>
        </Card>

        <Card title="Track performance">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Track</th>
                <th>Plays</th>
                <th>Payout (USDC)</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track) => (
                <tr key={track.name} className="analytics-row-tight">
                  <td>{track.name}</td>
                  <td>{track.plays.toLocaleString()}</td>
                  <td>{track.payout.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </main>
    </AuthGate>
  );
}
