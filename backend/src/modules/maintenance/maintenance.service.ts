import { Injectable } from "@nestjs/common";

@Injectable()
export class MaintenanceService {
  runRetentionCleanup() {
    return {
      status: "ok",
      purged: {
        sessions: 0,
        uploads: 0,
        analytics: 0,
      },
      ranAt: new Date().toISOString(),
    };
  }
}
