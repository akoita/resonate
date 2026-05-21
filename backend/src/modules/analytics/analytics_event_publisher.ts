import { PubSub, Topic } from "@google-cloud/pubsub";
import { AnalyticsEventEnvelope } from "./analytics_event";
import { writeStructuredLog } from "../shared/structured_logging";

export const ANALYTICS_EVENT_PUBLISHER = Symbol("ANALYTICS_EVENT_PUBLISHER");

export interface AnalyticsEventPublishResult {
  published: boolean;
  provider: "disabled" | "pubsub";
  messageId?: string;
  reason?: string;
}

export interface AnalyticsEventPublisher {
  publish(event: AnalyticsEventEnvelope): Promise<AnalyticsEventPublishResult>;
}

export interface AnalyticsPubSubPublisherConfig {
  enabled: boolean;
  strict: boolean;
  topicName?: string;
  projectId?: string;
}

export class DisabledAnalyticsEventPublisher implements AnalyticsEventPublisher {
  constructor(
    private readonly reason = "analytics event Pub/Sub publishing is disabled",
    private readonly strict = false,
  ) {}

  async publish(event: AnalyticsEventEnvelope): Promise<AnalyticsEventPublishResult> {
    if (this.strict) {
      writeStructuredLog(
        {
          level: "error",
          event: "analytics_event_publish_failed",
          message: this.reason,
          eventId: event.eventId,
          eventName: event.eventName,
          provider: "disabled",
        },
        console.error,
      );
      throw new Error(this.reason);
    }

    return {
      published: false,
      provider: "disabled",
      reason: this.reason,
    };
  }
}

export class PubSubAnalyticsEventPublisher implements AnalyticsEventPublisher {
  private readonly topic: Topic;

  constructor(
    private readonly config: Required<Pick<AnalyticsPubSubPublisherConfig, "enabled" | "strict" | "topicName">> &
      Pick<AnalyticsPubSubPublisherConfig, "projectId">,
    pubsub?: PubSub,
  ) {
    const client = pubsub ?? (config.projectId ? new PubSub({ projectId: config.projectId }) : new PubSub());
    this.topic = client.topic(config.topicName);
  }

  async publish(event: AnalyticsEventEnvelope): Promise<AnalyticsEventPublishResult> {
    try {
      const messageId = await this.topic.publishMessage({
        data: Buffer.from(JSON.stringify(event)),
        attributes: analyticsPubSubAttributes(event),
      });

      writeStructuredLog({
        level: "info",
        event: "analytics_event_published",
        message: "Published analytics event envelope to Pub/Sub",
        eventId: event.eventId,
        eventName: event.eventName,
        eventVersion: event.eventVersion,
        eventFamily: eventFamily(event.eventName),
        environment: event.environment,
        producer: event.producer,
        privacyTier: event.privacyTier,
        topicName: this.config.topicName,
        messageId,
      });

      return {
        published: true,
        provider: "pubsub",
        messageId,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      writeStructuredLog(
        {
          level: "error",
          event: "analytics_event_publish_failed",
          message: "Analytics event Pub/Sub publish failed",
          eventId: event.eventId,
          eventName: event.eventName,
          eventVersion: event.eventVersion,
          eventFamily: eventFamily(event.eventName),
          environment: event.environment,
          producer: event.producer,
          privacyTier: event.privacyTier,
          topicName: this.config.topicName,
          reason,
        },
        console.error,
      );

      if (this.config.strict) {
        throw error;
      }

      return {
        published: false,
        provider: "pubsub",
        reason,
      };
    }
  }
}

export function analyticsEventPublisherFromEnv(env: NodeJS.ProcessEnv = process.env): AnalyticsEventPublisher {
  const config = analyticsPubSubPublisherConfigFromEnv(env);

  if (!config.enabled) {
    return new DisabledAnalyticsEventPublisher();
  }

  if (!config.topicName) {
    return new DisabledAnalyticsEventPublisher(
      "analytics event Pub/Sub publishing is enabled but no topic is configured",
      config.strict,
    );
  }

  return new PubSubAnalyticsEventPublisher({
    enabled: true,
    strict: config.strict,
    topicName: config.topicName,
    projectId: config.projectId,
  });
}

export function analyticsPubSubPublisherConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AnalyticsPubSubPublisherConfig {
  return {
    enabled: parseBoolean(
      env.ANALYTICS_EVENT_PUBLISHING_ENABLED ?? env.ANALYTICS_EVENT_PIPELINE_ENABLED ?? env.ANALYTICS_PUBSUB_ENABLED,
    ),
    strict: parseBoolean(env.ANALYTICS_EVENT_PUBLISHING_STRICT ?? env.ANALYTICS_PUBSUB_STRICT),
    topicName: env.ANALYTICS_EVENT_PUBSUB_TOPIC || env.ANALYTICS_EVENTS_TOPIC_NAME || env.ANALYTICS_PUBSUB_TOPIC,
    projectId:
      env.ANALYTICS_EVENT_PUBSUB_PROJECT_ID ||
      env.ANALYTICS_PUBSUB_PROJECT_ID ||
      env.GCP_PROJECT_ID ||
      env.GOOGLE_CLOUD_PROJECT ||
      env.GCLOUD_PROJECT,
  };
}

export function analyticsPubSubAttributes(event: AnalyticsEventEnvelope): Record<string, string> {
  return {
    event_name: event.eventName,
    event_version: String(event.eventVersion),
    event_family: eventFamily(event.eventName),
    environment: event.environment,
    producer: event.producer,
    privacy_tier: event.privacyTier,
  };
}

function eventFamily(eventName: string) {
  return eventName.split(".")[0] || "unknown";
}

function parseBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}
