const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export type WalletRecord = {
  id: string;
  userId: string;
  address: string;
  chainId: number;
  balanceUsd: number;
  monthlyCapUsd: number;
  spentUsd: number;
  accountType?: string | null;
  provider?: string | null;
  ownerAddress?: string | null;
  entryPoint?: string | null;
  factory?: string | null;
  paymaster?: string | null;
  bundler?: string | null;
  salt?: string | null;
  deploymentTxHash?: string | null;
};

type AuthVerifyResponse =
  | { accessToken: string }
  | { status: "invalid_signature" | "invalid_nonce" };

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchNonce(address: string) {
  return apiRequest<{ nonce: string }>(
    "/auth/nonce",
    { method: "POST", body: JSON.stringify({ address }) },
  );
}

export async function verifySignature(input: {
  address: string;
  message: string;
  signature: `0x${string}`;
  role?: string;
}) {
  return apiRequest<AuthVerifyResponse>(
    "/auth/verify",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function fetchWallet(userId: string, token: string) {
  return apiRequest<WalletRecord>(`/wallet/${userId}`, {}, token);
}
