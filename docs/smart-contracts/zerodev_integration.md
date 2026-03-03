# ZeroDev Integration — Design Decision

> **See also:** [Account Abstraction Integration](../account-abstraction.md) for the comprehensive architecture guide (auth flow, session keys, agent purchases, API reference).

## Decision

Adopted **ZeroDev Kernel v3** as the smart account implementation, replacing the earlier Privy-based EOA flow. Key reasons:

- **Passkeys**: WebAuthn-based signing — no browser extensions, no seed phrases.
- **Modular validators**: ECDSA validator bridges passkey signers to the Kernel account; permission plugins enforce session key policies on-chain.
- **Session keys**: Kernel v3's policy stack (call, value, rate limit, timestamp) enables self-custodial agent delegation without the backend holding root keys.
- **Bundler/Paymaster**: ZeroDev hosted infrastructure for UserOp submission and gas sponsorship.

## Migration from Privy

- `AuthProvider` manages the ZeroDev client directly.
- `usePrivy` calls replaced with `useZeroDev` (custom hook in `ZeroDevProviderClient.tsx`).
- The `address` returned by auth context is the **Smart Account** address (not an EOA).

## Configuration

```typescript
const kernelAccount = await createKernelAccount(publicClient, {
  plugins: { sudo: ecdsaValidatorPlugin },
  entryPoint: ENTRYPOINT_ADDRESS_V07,
});
```
