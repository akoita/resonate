import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const KEY_STORAGE = "resonate.embedded.privateKey";

export function getOrCreateEmbeddedAccount() {
  if (typeof window === "undefined") {
    throw new Error("Embedded wallet only available in browser.");
  }
  let key = localStorage.getItem(KEY_STORAGE);
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(KEY_STORAGE, key);
  }
  return privateKeyToAccount(key as `0x${string}`);
}

export function clearEmbeddedAccount() {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(KEY_STORAGE);
}
