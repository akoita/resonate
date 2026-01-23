# ZeroDev Integration & Account Abstraction

## Overview
This document outlines the integration of ZeroDev for full Account Abstraction (AA) within Resonate. We are moving from a standard EOA-based flow (Privy) to a smart contract wallet flow (ZeroDev Kernel).

## Architecture
The new architecture leverages ZeroDev v3 (Kernel accounts) to provide:
- **Social Login**: Email/Social authentication as a signer for the smart account.
- **Passkeys**: WebAuthn-based signing for high security and convenience.
- **Smart Accounts**: All users interact via a Kernel Smart Account.
- **Gasless Transactions**: Using Permissionless.js and Pimlico/ZeroDev paymasters to sponsor transaction fees.

## Key Components

### 1. Smart Account (Kernel)
A Kernel account is a modular smart account. We use the standard Kernel v3 implementation.

### 2. Signer / Validator
The "owner" of the smart account is a signer handled by ZeroDev's social login or passkeys. We use an ECDSA Validator to bridge these signers to the Kernel account.

### 3. Bundler & Paymaster
We use Permissionless.js to interact with the ERC-4337 infrastructure:
- **Bundler**: Sends User Operations (UserOps) to the chain.
- **Paymaster**: Validates and pays for UserOps gas fees.

## Implementation Details

### Configuration
```typescript
const kernelAccount = await createKernelAccount(publicClient, {
  plugins: {
    sudo: ecdsaValidatorPlugin,
  },
  entryPoint: ENTRYPOINT_ADDRESS_V07,
});
```

### User Journey
1. **Connect**: User clicks "Connect" and chooses a social provider or passkey.
2. **Account Creation**: A Kernel account is deterministically calculated or deployed on the first transaction.
3. **Session**: The app stores the session and account state.
4. **Transactions**: The app constructs UserOps, gets sponsorship from the paymaster, and sends them via the bundler.

## Migration from Privy
- The `AuthProvider` will be refactored to manage the ZeroDev client.
- `usePrivy` calls will be replaced with `useZeroDev` (custom hook).
- The `address` returned by the auth context will now be the Smart Account address.
