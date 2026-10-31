import { describe, expect, it } from "vitest";
import {
  BILLING_CURRENCY_STORAGE_KEY,
  EU_VAT_TIME_ZONES,
  defaultBillingCurrency,
  formatMoney,
  formatWholeMoney,
  isEuVatTimeZone,
  priceNote,
  readStoredBillingCurrency,
  resolveBillingCurrency,
  taxLabel,
  writeStoredBillingCurrency,
} from "./billingCurrency";

const BOTH = ["usd", "eur"] as const;

describe("billing currency rule (#2496)", () => {
  it("treats EU VAT-area time zones as euro zones", () => {
    for (const zone of ["Europe/Paris", "Europe/Berlin", "Atlantic/Madeira", "Atlantic/Azores", "Asia/Nicosia", "Asia/Famagusta", "Europe/Monaco"]) {
      expect(isEuVatTimeZone(zone), zone).toBe(true);
    }
    expect(EU_VAT_TIME_ZONES).toContain("Europe/Dublin");
  });

  it("excludes EU territories outside the VAT area and non-EU zones", () => {
    for (const zone of [
      "Atlantic/Canary",
      "Africa/Ceuta",
      "Europe/Mariehamn",
      "Europe/Busingen",
      "America/Martinique",
      "Indian/Reunion",
      "America/New_York",
      "Europe/London",
      "Europe/Zurich",
    ]) {
      expect(isEuVatTimeZone(zone), zone).toBe(false);
    }
    expect(isEuVatTimeZone(null)).toBe(false);
    expect(isEuVatTimeZone("")).toBe(false);
  });

  it("defaults to eur only when the server offers it and the zone is in the EU VAT area", () => {
    expect(defaultBillingCurrency([...BOTH], "Europe/Paris")).toBe("eur");
    expect(defaultBillingCurrency(["usd"], "Europe/Paris")).toBe("usd");
    expect(defaultBillingCurrency([...BOTH], "Atlantic/Canary")).toBe("usd");
    expect(defaultBillingCurrency([...BOTH], "Europe/Busingen")).toBe("usd");
    expect(defaultBillingCurrency([...BOTH], "America/New_York")).toBe("usd");
    expect(defaultBillingCurrency([...BOTH], "Europe/London")).toBe("usd");
    expect(defaultBillingCurrency([...BOTH], null)).toBe("usd");
  });

  it("honours a preference only when it is offered", () => {
    expect(resolveBillingCurrency([...BOTH], "usd", "Europe/Paris")).toBe("usd");
    expect(resolveBillingCurrency([...BOTH], "eur", "America/New_York")).toBe("eur");
    expect(resolveBillingCurrency(["usd"], "eur", "Europe/Paris")).toBe("usd");
    expect(resolveBillingCurrency([...BOTH], null, "Europe/Paris")).toBe("eur");
    expect(resolveBillingCurrency([...BOTH], undefined, "America/New_York")).toBe("usd");
  });

  it("formats money and tax wording", () => {
    expect(formatMoney(1499, "usd")).toBe("$14.99");
    expect(formatMoney(1499, "eur")).toBe("€14.99");
    expect(formatMoney(14990, "eur")).toBe("€149.90");
    expect(formatWholeMoney(1000, "eur")).toBe("€10");
    expect(formatWholeMoney(1499, "usd")).toBe("$14.99");
    expect(taxLabel("eur")).toBe("VAT included");
    expect(taxLabel("usd")).toBe("plus any applicable tax");
    expect(priceNote("eur")).toContain("VAT included");
    expect(priceNote("usd")).toContain("plus any applicable tax");
  });

  it("remembers the choice and never throws when storage is unavailable", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    expect(readStoredBillingCurrency(storage)).toBeNull();
    writeStoredBillingCurrency("eur", storage);
    expect(data.get(BILLING_CURRENCY_STORAGE_KEY)).toBe("eur");
    expect(readStoredBillingCurrency(storage)).toBe("eur");
    data.set(BILLING_CURRENCY_STORAGE_KEY, "gbp");
    expect(readStoredBillingCurrency(storage)).toBeNull();

    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredBillingCurrency(blocked)).toBeNull();
    expect(() => writeStoredBillingCurrency("usd", blocked)).not.toThrow();
    // No window in this environment: still safe.
    expect(readStoredBillingCurrency()).toBeNull();
  });
});
