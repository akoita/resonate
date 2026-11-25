/**
 * How many proxies in front of the backend Express may trust (`TRUST_PROXY_HOPS`).
 *
 * Behind a load balancer the socket address is the balancer's, so without
 * this every client shares one `req.ip` and one per-address rate-limit
 * bucket. Trusting more hops than really exist is worse: a client could then
 * pick its own address with an `X-Forwarded-For` header and step around every
 * per-address limit. So the value states the real number of proxies that
 * append to `X-Forwarded-For`, and nothing is trusted when it is unset.
 *
 * Returns `undefined` to leave Express's default (trust nothing).
 */
export function trustProxyHops(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`TRUST_PROXY_HOPS must be a whole number of proxies, got "${env.TRUST_PROXY_HOPS}"`);
  }
  const hops = Number.parseInt(raw, 10);
  if (hops > 10) {
    throw new Error(`TRUST_PROXY_HOPS=${hops} is not a plausible proxy chain; at most 10`);
  }
  return hops === 0 ? undefined : hops;
}

/** Applies `trustProxyHops` to an Express app; returns the value applied. */
export function applyTrustProxy(
  expressApp: { set(setting: string, value: unknown): unknown },
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const hops = trustProxyHops(env);
  if (hops !== undefined) {
    expressApp.set("trust proxy", hops);
  }
  return hops;
}
