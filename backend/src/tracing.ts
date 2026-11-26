/**
 * Distributed tracing with OpenTelemetry, exported to Google Cloud Trace.
 *
 * What it gives: for a sampled request, a timeline ("trace") of where the
 * time went: the incoming HTTP request, the Nest handler, and every outgoing
 * HTTP call it made (Vertex, bundler, RPC, storage). Logs written during the
 * request carry the same trace id, so Cloud Logging can show "all logs for
 * this request" and Cloud Trace can jump to them.
 *
 * Why OpenTelemetry: it is the vendor-neutral standard. The same code can
 * export to Cloud Trace today and to Grafana, Jaeger or Honeycomb later by
 * changing the endpoint, not the instrumentation.
 *
 * How it exports: OTLP over HTTP/protobuf straight to Google's Telemetry API
 * (`telemetry.googleapis.com`), authenticated with the service account's
 * Application Default Credentials. No collector sidecar is needed.
 *
 * Cost: Cloud Trace includes 2.5 million spans a month for free. Traces are
 * sampled (`OTEL_TRACES_SAMPLE_RATIO`, default 10% of new requests) and
 * health checks are never traced, so staging stays far below that.
 *
 * Off unless `OTEL_TRACES_ENABLED=true`, so local runs and tests export
 * nothing. Must be imported before anything else in `main.ts`: the
 * instrumentations patch `http` and `express` as they are first loaded.
 */
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { NestInstrumentation } from "@opentelemetry/instrumentation-nestjs-core";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { gcpDetector } from "@opentelemetry/resource-detector-gcp";
import { detectResources, resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { GoogleAuth } from "google-auth-library";
import { setTraceLogProject } from "./modules/shared/trace_log_fields";

const DEFAULT_ENDPOINT = "https://telemetry.googleapis.com";
const DEFAULT_SAMPLE_RATIO = 0.1;
const DEFAULT_SERVICE_NAME = "resonate-backend";

/** Paths that are polled by probes and would only add noise and cost. */
const UNTRACED_PATH_PREFIXES = ["/health", "/metadata/indexer/status"];

/** Our own telemetry and auth traffic is never traced (it would trace itself). */
const UNTRACED_HOSTS = ["telemetry.googleapis.com", "oauth2.googleapis.com", "metadata.google.internal", "169.254.169.254"];

export type TracingConfig = {
  enabled: boolean;
  endpoint: string;
  sampleRatio: number;
  serviceName: string;
  serviceVersion: string;
  projectId?: string;
};

export function tracingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TracingConfig {
  const ratio = Number(env.OTEL_TRACES_SAMPLE_RATIO);
  return {
    enabled: env.OTEL_TRACES_ENABLED?.trim().toLowerCase() === "true",
    endpoint: (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, ""),
    sampleRatio: Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : DEFAULT_SAMPLE_RATIO,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    serviceVersion: env.APP_VERSION?.trim() || "unknown",
    projectId: env.GCP_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || undefined,
  };
}

export function isUntracedIncomingPath(url: string | undefined): boolean {
  const path = (url ?? "/").split("?")[0];
  return UNTRACED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function isUntracedOutgoingHost(host: string | undefined): boolean {
  const name = (host ?? "").split(":")[0].toLowerCase();
  return UNTRACED_HOSTS.includes(name);
}

function isGoogleEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname.endsWith(".googleapis.com");
  } catch {
    return false;
  }
}

export function startTracing(config: TracingConfig = tracingConfigFromEnv()): NodeTracerProvider | null {
  if (!config.enabled) return null;
  if (!config.projectId) {
    console.warn("[Tracing] OTEL_TRACES_ENABLED is set but GCP_PROJECT_ID is not; tracing stays off.");
    return null;
  }

  // Google's endpoint needs the service account's token; a local collector
  // (for example Jaeger at http://localhost:4318 while learning) does not.
  const auth = isGoogleEndpoint(config.endpoint)
    ? new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] })
    : null;
  const exporter = new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
    ...(auth ? { headers: async () => ({ Authorization: `Bearer ${await auth.getAccessToken()}` }) } : {}),
  });

  const resource = resourceFromAttributes({
    "service.name": config.serviceName,
    "service.version": config.serviceVersion,
    // Required by the Telemetry API to route spans to the right project.
    "gcp.project_id": config.projectId,
  }).merge(detectResources({ detectors: [gcpDetector] }));

  const provider = new NodeTracerProvider({
    resource,
    // Keep a request's whole trace together: follow the caller's decision
    // when there is one, otherwise sample this share of new traces.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register();

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => isUntracedIncomingPath(request.url),
        ignoreOutgoingRequestHook: (options) => isUntracedOutgoingHost(options.hostname ?? options.host ?? undefined),
        // Never record header values: they carry tokens and payment proofs.
        headersToSpanAttributes: { client: { requestHeaders: [], responseHeaders: [] }, server: { requestHeaders: [], responseHeaders: [] } },
      }),
      // Node's built-in fetch (used by the AI and RPC clients) runs on undici.
      new UndiciInstrumentation({
        ignoreRequestHook: (request) => isUntracedOutgoingHost(new URL(request.origin).host),
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
    ],
  });

  setTraceLogProject(config.projectId);

  // Flush buffered spans when Cloud Run stops the instance.
  process.once("SIGTERM", () => {
    void provider.shutdown().catch(() => undefined);
  });

  console.log(
    `[Tracing] OpenTelemetry tracing on: ${Math.round(config.sampleRatio * 100)}% of new requests to ${config.endpoint}`,
  );
  return provider;
}

startTracing();
