"use client";

import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { UnclaimedRefundsSection } from "../../../components/shows/UnclaimedRefundsSection";

/** #2149: operators see every refund-open Shows campaign with unclaimed refunds. */
export default function AdminUnclaimedRefundsPage() {
  const { role } = useAuth();
  const isOperator = role === "admin" || role === "operator";
  return (
    <AuthGate title="Sign in with an operator account to see unclaimed refunds.">
      {!isOperator ? (
        <p className="ui-card" style={{ padding: "20px" }}>
          Only operators and admins can see unclaimed refunds.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "20px", maxWidth: "960px" }}>
          <header>
            <h1 style={{ margin: 0 }}>Unclaimed Shows refunds</h1>
            <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
              Backers of failed or cancelled campaigns who have not claimed their refund yet.
            </p>
          </header>
          <UnclaimedRefundsSection />
        </div>
      )}
    </AuthGate>
  );
}
