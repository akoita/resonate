import { Injectable } from "@nestjs/common";

interface TrackStats {
  trackId: string;
  title: string;
  plays: number;
  payoutUsd: number;
}

@Injectable()
export class AnalyticsService {
  getArtistStats(artistId: string, days: number) {
    const summary = {
      artistId,
      days,
      totalPlays: 0,
      totalPayoutUsd: 0,
    };
    const tracks: TrackStats[] = [];
    return { summary, tracks };
  }
}
