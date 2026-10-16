import { EmailConfig } from "../modules/email/email_config";
import { emailDeliveryLogFields, exitCodeFor, isDryRun, parseLimit } from "../scripts/run_email_deliveries";

describe("run_email_deliveries script helpers", () => {
  it("parses --dry-run and --limit", () => {
    expect(isDryRun(["--dry-run"])).toBe(true);
    expect(isDryRun([])).toBe(false);
    expect(parseLimit(["--limit", "25"])).toBe(25);
    expect(parseLimit(["--limit", "0"])).toBeUndefined();
    expect(parseLimit(["--limit", "abc"])).toBeUndefined();
    expect(parseLimit([])).toBeUndefined();
  });

  it("exits 1 for a permanent failure or a misconfiguration, 0 for a clean run or email never configured", () => {
    expect(exitCodeFor({ failed: 0 })).toBe(0);
    expect(exitCodeFor({ failed: 2 })).toBe(1);
    expect(exitCodeFor({ failed: 0 }, new EmailConfig({ NODE_ENV: "production" }))).toBe(0);
    expect(exitCodeFor({ failed: 0 }, new EmailConfig({ NODE_ENV: "production", EMAIL_TRANSPORT: "smtp" }))).toBe(1);
    expect(exitCodeFor({ failed: 0 }, new EmailConfig({ NODE_ENV: "test" }))).toBe(0);
  });

  it("logs counts only", () => {
    const fields = emailDeliveryLogFields({
      dryRun: false,
      enabled: true,
      fannedOutNotices: 1,
      queued: 2,
      due: 3,
      sent: 4,
      failed: 5,
      suppressed: 6,
      bounced: 7,
      pruned: 8,
    });
    expect(Object.values(fields).every((v) => typeof v === "number" || typeof v === "boolean")).toBe(true);
  });
});
