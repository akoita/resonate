import { Injectable } from "@nestjs/common";

interface TrackRecord {
  id: string;
  artistId: string;
  title: string;
  stems: { id: string; type: string; uri: string }[];
}

@Injectable()
export class CatalogService {
  private tracks = new Map<string, TrackRecord>();

  createTrack(input: { artistId: string; title: string }) {
    const id = this.generateId("trk");
    const record: TrackRecord = {
      id,
      artistId: input.artistId,
      title: input.title,
      stems: [],
    };
    this.tracks.set(id, record);
    return record;
  }

  getTrack(trackId: string) {
    return this.tracks.get(trackId) ?? null;
  }

  search(query: string) {
    const normalized = query.toLowerCase();
    const results = Array.from(this.tracks.values()).filter((track) =>
      track.title.toLowerCase().includes(normalized)
    );
    return { items: results };
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }
}
