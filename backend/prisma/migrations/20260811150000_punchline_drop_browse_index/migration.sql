-- Support the published, newest-first candidate scan used by public Drops browse.
CREATE INDEX "PunchlineDrop_status_publishedAt_id_idx"
ON "PunchlineDrop"("status", "publishedAt", "id");
