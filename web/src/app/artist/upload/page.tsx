export default function ArtistUploadPage() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "32px" }}>
      <h1>Artist Upload</h1>
      <p>Upload stems (MVP placeholder).</p>
      <form>
        <label>
          Track title
          <input type="text" name="title" />
        </label>
        <br />
        <label>
          File URIs (comma-separated)
          <input type="text" name="uris" />
        </label>
        <br />
        <button type="submit">Submit</button>
      </form>
    </main>
  );
}
