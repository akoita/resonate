import { context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { writeStructuredLog } from "../modules/shared/structured_logging";
import { setTraceLogProject, traceLogFields } from "../modules/shared/trace_log_fields";
import { isUntracedIncomingPath, isUntracedOutgoingHost, startTracing, tracingConfigFromEnv } from "../tracing";

describe("tracing configuration", () => {
  it("is off unless explicitly enabled", () => {
    expect(tracingConfigFromEnv({}).enabled).toBe(false);
    expect(tracingConfigFromEnv({ OTEL_TRACES_ENABLED: "TRUE" }).enabled).toBe(true);
    expect(startTracing(tracingConfigFromEnv({}))).toBeNull();
  });

  it("refuses to start without a project id", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(startTracing(tracingConfigFromEnv({ OTEL_TRACES_ENABLED: "true" }))).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("bounds the sample ratio and defaults the endpoint", () => {
    expect(tracingConfigFromEnv({ OTEL_TRACES_SAMPLE_RATIO: "0.25" }).sampleRatio).toBe(0.25);
    expect(tracingConfigFromEnv({ OTEL_TRACES_SAMPLE_RATIO: "7" }).sampleRatio).toBe(0.1);
    expect(tracingConfigFromEnv({}).endpoint).toBe("https://telemetry.googleapis.com");
    expect(tracingConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318/" }).endpoint).toBe(
      "http://collector:4318",
    );
  });

  it("skips probes and its own telemetry traffic", () => {
    expect(isUntracedIncomingPath("/health")).toBe(true);
    expect(isUntracedIncomingPath("/health?x=1")).toBe(true);
    expect(isUntracedIncomingPath("/healthy-tracks")).toBe(false);
    expect(isUntracedIncomingPath("/catalog")).toBe(false);
    expect(isUntracedOutgoingHost("telemetry.googleapis.com:443")).toBe(true);
    expect(isUntracedOutgoingHost("aiplatform.googleapis.com")).toBe(false);
  });
});

describe("trace log fields", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

  beforeAll(() => {
    // Registers the async context manager that real tracing uses.
    provider.register();
  });

  afterAll(() => {
    setTraceLogProject(undefined);
    trace.disable();
    context.disable();
  });

  it("adds nothing outside a trace or before tracing starts", () => {
    setTraceLogProject(undefined);
    expect(traceLogFields()).toEqual({});
  });

  it("links log lines to the active span", () => {
    setTraceLogProject("demo-project");
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const span = provider.getTracer("test").startSpan("request");
    context.with(trace.setSpan(context.active(), span), () => {
      writeStructuredLog({ level: "info", event: "test.event", message: "inside" });
    });
    span.end();
    const payload = JSON.parse(info.mock.calls[0][0] as string);
    expect(payload["logging.googleapis.com/trace"]).toBe(`projects/demo-project/traces/${span.spanContext().traceId}`);
    expect(payload["logging.googleapis.com/spanId"]).toBe(span.spanContext().spanId);
    info.mockRestore();
  });
});
