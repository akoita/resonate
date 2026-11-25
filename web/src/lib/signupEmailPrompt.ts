/**
 * #2665: right after a new account is created, offer to add an email address
 * once. The flag lives in sessionStorage so it survives the sign-up redirect
 * but not a later visit; storage that is unavailable simply skips the offer.
 */
const KEY = "resonate.signup_email_prompt";

export function markSignupEmailPrompt(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Private mode or blocked storage: no offer, the Settings reminder remains.
  }
}

export function hasSignupEmailPrompt(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearSignupEmailPrompt(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

