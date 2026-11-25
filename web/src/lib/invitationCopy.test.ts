import { describe, expect, it } from "vitest";
import { describeInvitationCheck, isInviteStatus, readRememberedInvite, rememberInviteFromUrl } from "./invitationCopy";

describe("invitation copy (#2662)", () => {
  it("knows the sign-in refusals that need a code", () => {
    expect(isInviteStatus("invite_required")).toBe(true);
    expect(isInviteStatus("invalid_nonce")).toBe(false);
  });

  it("describes every check result in plain words", () => {
    expect(describeInvitationCheck({ status: "valid", role: "artist" })).toMatch(/founding-artist/);
    expect(describeInvitationCheck({ status: "valid", role: "listener" })).toMatch(/Create your account/);
    expect(describeInvitationCheck({ status: "used" })).toMatch(/already been used/);
    expect(describeInvitationCheck({ status: "artist_cap_reached" })).toMatch(/waiting list/);
  });

  it("keeps a code from an invite link for the dialog", () => {
    const store = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void store.set(k, v), getItem: (k: string) => store.get(k) ?? null };
    expect(rememberInviteFromUrl("?invite=ABCD-EFGH-JKMN", storage)).toBe("ABCD-EFGH-JKMN");
    expect(readRememberedInvite(storage)).toBe("ABCD-EFGH-JKMN");
    expect(rememberInviteFromUrl("?other=1", storage)).toBeNull();
  });
});
