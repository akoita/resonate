import { Button } from "../components/ui/Button";

export default function Home() {
  return (
    <main>
      <h1>Resonate</h1>
      <p>Artist tools (MVP)</p>
      <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
        <a href="/artist/upload">
          <Button>Upload stems</Button>
        </a>
        <a href="/artist/analytics">
          <Button variant="ghost">Analytics</Button>
        </a>
      </div>
    </main>
  );
}
