import { Card } from "../../../components/ui/Card";

const tracks = [
  { name: "Neon Drift", plays: 4820, payout: 320.5 },
  { name: "Satellite", plays: 3910, payout: 255.0 },
  { name: "Glass City", plays: 2750, payout: 190.25 },
];

export default function ArtistAnalyticsPage() {
  return (
    <main style={{ display: "grid", gap: "24px" }}>
      <h1>Artist Analytics</h1>
      <div className="analytics-grid">
        <Card title="Total Plays">11,480</Card>
        <Card title="Total Payout">USDC 765.75</Card>
        <Card title="Top Track">Neon Drift</Card>
        <Card title="Followers">3,420</Card>
      </div>

      <Card title="Plays over time">
        <div className="analytics-chart" />
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
              <tr key={track.name}>
                <td>{track.name}</td>
                <td>{track.plays.toLocaleString()}</td>
                <td>{track.payout.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
