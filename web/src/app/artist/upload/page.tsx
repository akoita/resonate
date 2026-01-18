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
        <div className="upload-panel">
          <div className="upload-section-title">Upload your track</div>
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
        </div>
      </Card>

      <Card title="Release settings">
        <div className="upload-panel">
          <label>
            Release type (single/EP/album)
            <Input name="releaseType" placeholder="single" />
          </label>
          <label>
            Release title
            <Input name="releaseTitle" placeholder="Night Drive" />
          </label>
          <label>
            Track title
            <Input name="title" placeholder="Night Drive" />
          </label>
          <label>
            Primary artist
            <Input name="primaryArtist" placeholder="Aya Lune" />
          </label>
          <label>
            Featured artists (comma-separated)
            <Input name="featuredArtists" placeholder="Kiro, Mira" />
          </label>
          <label>
            Genre
            <Input name="genre" placeholder="Electronic" />
          </label>
          <label>
            ISRC (optional)
            <Input name="isrc" placeholder="US-XYZ-24-00001" />
          </label>
          <label>
            Label (optional)
            <Input name="label" placeholder="Resonate Records" />
          </label>
          <label>
            Release date (optional)
            <Input name="releaseDate" placeholder="2026-01-18" />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input name="explicit" type="checkbox" />
            Explicit content
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
