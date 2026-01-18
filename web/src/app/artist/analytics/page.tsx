export default function ArtistAnalyticsPage() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "32px" }}>
      <h1>Artist Analytics</h1>
      <p>Daily plays and payouts (MVP placeholder).</p>
      <table>
        <thead>
          <tr>
            <th>Track</th>
            <th>Plays</th>
            <th>Payout (USD)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Example Track</td>
            <td>0</td>
            <td>0.00</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
