import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";

  const stems = [
  { name: "vocals.wav", status: "Processing", progress: 60 },
  { name: "drums.wav", status: "Ready", progress: 100 },
  { name: "bass.wav", status: "Ready", progress: 100 },
];
  const allReady = stems.every((stem) => stem.status === "Ready");

export default function ArtistUploadPage() {
  return (
    <main className="upload-grid">
      <Card>
        <h2>Upload your track</h2>
        <p className="home-subtitle">
          Drag and drop your audio file to begin stem separation.
        </p>
        <div className="upload-drop upload-drop-active">
          Drop audio file here
        </div>
        <div className="upload-list">
          {stems.map((stem) => (
            <div key={stem.name} className="upload-item">
              <div>
                <div>{stem.name}</div>
                <div className="upload-status">{stem.status}</div>
                <div className="upload-progress">
                  <div
                    className="upload-progress-bar"
                    style={{ width: `${stem.progress}%` }}
                  />
                </div>
              </div>
              <Button variant="ghost">Preview</Button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Release settings">
        <div style={{ display: "grid", gap: "12px" }}>
          <label>
            Track title
            <Input name="title" placeholder="Night Drive" />
          </label>
          <label>
            Remix price (USDC)
            <Input name="remixPrice" placeholder="5" />
          </label>
          <label>
            Commercial price (USDC)
            <Input name="commercialPrice" placeholder="25" />
          </label>
          <Button variant={allReady ? "primary" : "ghost"}>
            Publish release
          </Button>
        </div>
      </Card>
    </main>
  );
}
