import { isProduction } from "./buildInfo";

const FUNDING_ANNOUNCEMENT_KEY_PREFIX = "resonate.fundingAnnouncement";
const EXCEPTIONAL_FUNDING_CHAIN_IDS = new Set([31337, 84532, 11155111]);

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

export function shouldAnnounceExceptionalFunding(chainId: number | null | undefined, balanceWei?: bigint | null) {
  if (!chainId || isProduction()) return false;
  return EXCEPTIONAL_FUNDING_CHAIN_IDS.has(chainId) && (balanceWei ?? 0n) > 0n;
}

export function fundingAnnouncementKey(address: string, chainId: number) {
  return `${FUNDING_ANNOUNCEMENT_KEY_PREFIX}.${chainId}.${normalizeAddress(address)}`;
}

export function hasSeenFundingAnnouncement(address: string, chainId: number) {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(fundingAnnouncementKey(address, chainId)) === "shown";
}

export function markFundingAnnouncementSeen(address: string, chainId: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(fundingAnnouncementKey(address, chainId), "shown");
}
