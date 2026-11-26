// Runs in the browser before the app becomes interactive (Next.js
// instrumentation-client convention). Keep it tiny: it is on every page.
import { installBrowserErrorReporting } from "./lib/monitoring/browserErrors";

try {
  installBrowserErrorReporting(window);
} catch {
  // Monitoring must never stop the app from starting.
}
