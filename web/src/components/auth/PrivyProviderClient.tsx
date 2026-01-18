"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import PrivyBridge from "./PrivyBridge";

export default function PrivyProviderClient({
  appId,
  children,
}: {
  appId: string;
  children: React.ReactNode;
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
