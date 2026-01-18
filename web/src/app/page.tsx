export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "32px" }}>
      <h1>Resonate</h1>
      <p>Artist tools (MVP)</p>
      <ul>
        <li>
          <a href="/artist/upload">Upload stems</a>
        </li>
        <li>
          <a href="/artist/analytics">Analytics</a>
        </li>
      </ul>
    </main>
  );
}
