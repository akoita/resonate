import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WithdrawalState } from "../../lib/api";
import { WithdrawContractView, refundLine, type WithdrawContractViewProps } from "./WithdrawContract";

const labels: WithdrawalState["labels"] = {
  version: "test",
  entryButton: "Withdraw from contract",
  sectionTitle: "Withdraw from a contract",
  sectionIntro: "You can withdraw within 14 days.",
  formTitle: "Your withdrawal statement",
  nameLabel: "Your name",
  contractLabel: "The contract you withdraw from",
  confirmationLabel: "Where we send the confirmation",
  confirmationToEmail: "To your notices and by email to {email}.",
  confirmationToNotices: "To your notices in Resonate.",
  continueButton: "Continue",
  cancelButton: "Go back",
  confirmButton: "Confirm withdrawal",
  doneTitle: "Withdrawal received",
  doneBody: "Your refund has started.",
  refundArtistPro: "Artist Pro ends now; we refund {refund}.",
  refundCreditPack: "We refund the full price ({refund}).",
  fallback: "You can also write to us.",
};

const pro = {
  contract: "artist_pro" as const,
  subjectId: "inv-1",
  label: "Artist Pro (monthly)",
  boughtAt: "2026-11-20T10:00:00.000Z",
  rightEndsAt: "2026-12-04T10:00:00.000Z",
  currency: "usd",
  paidCents: 1499,
  refundCents: 1350,
};

function state(overrides: Partial<WithdrawalState> = {}): WithdrawalState {
  return { labels, confirmationEmail: null, contracts: [pro], withdrawals: [], ...overrides };
}

function render(props: Partial<WithdrawContractViewProps> = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <WithdrawContractView
      state={state()}
      step="closed"
      name=""
      selected={null}
      busy={false}
      onOpen={noop}
      onNameChange={noop}
      onSelect={noop}
      onContinue={noop}
      onBack={noop}
      onConfirm={noop}
      {...props}
    />,
  );
}

describe("WithdrawContractView (#2594)", () => {
  it("shows the entry button and the deadline only while a right exists", () => {
    const html = render();
    expect(html).toContain("Withdraw from contract");
    expect(html).toContain("you can withdraw until Dec 4, 2026");
    expect(render({ state: state({ contracts: [] }) })).toBe("");
  });

  it("asks for the statement with nothing chosen or ticked for the person", () => {
    const html = render({ step: "form" });
    expect(html).toContain("Your name");
    expect(html).toContain("The contract you withdraw from");
    expect(html).not.toContain("checked");
    expect(html).toContain("To your notices in Resonate.");
    expect(html).toContain("You can also write to us.");
    expect(render({ step: "form", state: state({ confirmationEmail: "a•••@x.test" }) })).toContain("by email to a•••@x.test");
  });

  it("states the refund once a contract is chosen", () => {
    expect(render({ step: "form", selected: "inv-1", name: "Ada" })).toContain("Artist Pro ends now; we refund $13.50.");
    expect(refundLine(labels, { ...pro, contract: "credit_topup", refundCents: 1000, currency: "eur" })).toBe(
      "We refund the full price (€10.00).",
    );
  });

  it("makes the confirmation step a bare button with no other text", () => {
    const html = render({ step: "confirm", selected: "inv-1", name: "Ada" });
    expect(html).toContain(">Confirm withdrawal<");
    expect(html).not.toContain("Your name");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("refund");
  });

  it("acknowledges and lists past withdrawals with their refund", () => {
    const html = render({
      step: "done",
      state: state({
        contracts: [],
        withdrawals: [
          { id: "w1", contract: "artist_pro", label: "Artist Pro (monthly)", withdrawnAt: "2026-11-23T19:00:00.000Z", currency: "usd", refundCents: 1350, refundStatus: "refunded" },
        ],
      }),
    });
    expect(html).toContain("Withdrawal received");
    expect(html).toContain("Withdrew from Artist Pro (monthly) on Nov 23, 2026: $13.50, refund sent to your card.");
  });
});
