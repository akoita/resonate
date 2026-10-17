import { renderConfirmationEmail, renderNoticeEmail } from "../modules/email/email_templates";

const settings = {
  frontendUrl: "https://app.example.test",
  publicApiUrl: "https://api.example.test",
  linkSigningSecret: "templates-secret",
};
const base = { userId: "u1", to: "a@b.example", title: "Policy changes", body: "First line.\n\nSecond paragraph.", link: null };

const SETTINGS_URL = "https://app.example.test/settings?section=email";
const PRIVACY_URL = "https://app.example.test/privacy";

function urlsIn(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
}

describe("renderConfirmationEmail", () => {
  const mail = renderConfirmationEmail("a@b.example", "tok/en+1", settings);
  const url = "https://app.example.test/email/confirm?token=tok%2Fen%2B1";

  it("keeps the subject", () => {
    expect(mail.subject).toBe("Confirm your email for Resonate notices");
  });

  it("writes the full confirmation URL in both parts, plus a button in the HTML", () => {
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`href="${url}"`);
    // Written out as visible text under the button, not only as an href.
    expect(mail.html).toContain(`>${url}</a>`);
    expect(mail.html).toContain("If the button does not work");
  });

  it("explains why, the expiry and what to do if it was not requested, in both parts", () => {
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("You added this address in Resonate Settings");
      expect(part).toContain("works once and expires in 24 hours");
      expect(part).toContain("ignore this email");
      expect(part).toContain("Nothing will be sent to this address unless you confirm it");
    }
  });

  it("has a footer with the settings and privacy links and no unsubscribe link or header", () => {
    expect(mail.text).toContain(SETTINGS_URL);
    expect(mail.text).toContain(PRIVACY_URL);
    expect(urlsIn(mail.html)).toEqual(expect.arrayContaining([url, SETTINGS_URL, PRIVACY_URL]));
    expect(mail.text + mail.html).not.toContain("/email/unsubscribe");
    expect(mail.headers).toBeUndefined();
  });

  it("is plain, self-contained HTML: no remote images, scripts or tracking", () => {
    expect(mail.html.startsWith("<!doctype html>")).toBe(true);
    expect(mail.html).not.toMatch(/<img|<script|<link|@import|url\(/i);
  });

  it("adds the operator footer line only when configured, escaped", () => {
    expect(mail.text).not.toContain("Example Org");
    const withFooter = renderConfirmationEmail("a@b.example", "t", { ...settings, footerText: "Example Org <ops@example.org>\n1 Example Street" });
    expect(withFooter.text).toContain("Example Org <ops@example.org>\n1 Example Street");
    expect(withFooter.html).toContain("Example Org &lt;ops@example.org&gt;<br>1 Example Street");
    expect(withFooter.html).not.toContain("<ops@example.org>");
  });
});

describe("renderNoticeEmail", () => {
  describe("optional categories", () => {
    const mail = renderNoticeEmail({ ...base, category: "policy", link: "/help/platform-notices" }, settings);

    it("uses a [Resonate] subject", () => {
      expect(mail.subject).toBe("[Resonate] Policy changes");
    });

    it("shows the category, title, body and the full link in both parts", () => {
      const link = "https://app.example.test/help/platform-notices";
      for (const part of [mail.text, mail.html]) {
        expect(part).toContain("Policy update");
        expect(part).toContain("Policy changes");
        expect(part).toContain("First line.");
        expect(part).toContain("Second paragraph.");
        expect(part).toContain(link);
      }
      expect(mail.html).toContain(`href="${link}"`);
      expect(mail.html).toContain(`>${link}</a>`);
      expect(mail.html).toContain("If the button does not work");
    });

    it("links to the home page when the notice has no link", () => {
      const noLink = renderNoticeEmail({ ...base, category: "policy" }, settings);
      expect(noLink.text).toContain("Open Resonate: https://app.example.test/");
    });

    it("has the unsubscribe link in both parts, the settings and privacy links, and the one-click headers", () => {
      expect(mail.text).toContain("https://app.example.test/email/unsubscribe?token=");
      expect(urlsIn(mail.html).some((u) => u.startsWith("https://app.example.test/email/unsubscribe?token="))).toBe(true);
      for (const part of [mail.text, mail.html]) {
        expect(part).toContain(SETTINGS_URL);
        expect(part).toContain(PRIVACY_URL);
        expect(part).toContain("You are receiving this because you added this address in Resonate Settings");
      }
      expect(mail.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/api\.example\.test\/email\/unsubscribe\/one-click\?token=/);
      expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    });
  });

  describe.each(["terms", "account"])("required category %s", (category) => {
    const mail = renderNoticeEmail({ ...base, category, link: "/help/platform-notices" }, settings);

    it("has no unsubscribe link or headers, and says it is required", () => {
      expect(mail.headers).toEqual({});
      expect(mail.text + mail.html).not.toContain("/email/unsubscribe");
      expect(mail.text).toContain(`required ${category} notice`);
      expect(mail.html).toContain(`required ${category} notice`);
    });

    it("still links to the email settings and the privacy policy", () => {
      for (const part of [mail.text, mail.html]) {
        expect(part).toContain(SETTINGS_URL);
        expect(part).toContain(PRIVACY_URL);
      }
    });
  });

  it("adds the operator footer line only when EMAIL_FOOTER_TEXT is set", () => {
    const plain = renderNoticeEmail({ ...base, category: "policy" }, settings);
    expect(plain.text).not.toContain("Example Org");
    expect(plain.html).not.toContain("Example Org");
    const withFooter = renderNoticeEmail({ ...base, category: "terms" }, { ...settings, footerText: "Example Org, 1 Example Street" });
    expect(withFooter.text).toContain("Example Org, 1 Example Street");
    expect(withFooter.html).toContain("Example Org, 1 Example Street");
  });

  it("is plain, self-contained HTML: no remote images, scripts or tracking", () => {
    const mail = renderNoticeEmail({ ...base, category: "policy" }, settings);
    expect(mail.html.startsWith("<!doctype html>")).toBe(true);
    expect(mail.html).not.toMatch(/<img|<script|<link|@import|url\(/i);
  });

  describe("HTML escaping", () => {
    const hostile = {
      ...base,
      category: "policy",
      title: `<script>alert("t")</script> & 'q'`,
      body: `<script>alert("b")</script> <img src=x onerror=alert(1)> & "quoted" 'single'\nnext <b>line</b>`,
    };
    const mail = renderNoticeEmail(hostile, settings);

    it("escapes the title and body in the HTML part, including the document title and heading", () => {
      expect(mail.html).not.toContain("<script");
      expect(mail.html).not.toContain("<img");
      expect(mail.html).not.toContain("<b>line</b>");
      expect(mail.html).toContain("&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt; &amp; &#39;q&#39;");
      expect(mail.html).toContain("&lt;script&gt;alert(&quot;b&quot;)&lt;/script&gt;");
      expect(mail.html).toContain("&quot;quoted&quot; &#39;single&#39;");
      expect(mail.html).toContain("&amp;");
      expect(mail.html).toContain("<br>next &lt;b&gt;line&lt;/b&gt;");
    });

    it("leaves the plain-text part as typed", () => {
      expect(mail.text).toContain(hostile.body);
      expect(mail.text).toContain(hostile.title);
    });

    it("escapes the notice link when it is placed in an attribute", () => {
      const withLink = renderNoticeEmail({ ...hostile, link: '/x"onmouseover="alert(1)' }, settings);
      expect(withLink.html).not.toContain('"onmouseover="');
      expect(withLink.html).toContain("&quot;onmouseover=&quot;");
    });
  });

  describe("subject", () => {
    it("strips newlines so a title cannot start another header", () => {
      const mail = renderNoticeEmail({ ...base, category: "policy", title: "Hello\r\nBcc: x@y.example" }, settings);
      expect(mail.subject).toBe("[Resonate] Hello Bcc: x@y.example");
      expect(mail.subject).not.toMatch(/[\r\n]/);
    });

    it("stays within 78 characters by cutting a long title", () => {
      const mail = renderNoticeEmail({ ...base, category: "policy", title: "word ".repeat(40) }, settings);
      expect(mail.subject.length).toBeLessThanOrEqual(78);
      expect(mail.subject.startsWith("[Resonate] word word")).toBe(true);
      expect(mail.subject.endsWith("...")).toBe(true);
    });

    it("keeps a short title whole", () => {
      const mail = renderNoticeEmail({ ...base, category: "policy", title: "x".repeat(67) }, settings);
      expect(mail.subject).toBe(`[Resonate] ${"x".repeat(67)}`);
    });
  });
});
