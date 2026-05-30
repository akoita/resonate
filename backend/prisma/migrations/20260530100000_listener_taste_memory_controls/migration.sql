-- Durable listener taste memory governance controls.
CREATE TABLE "ListenerTasteMemorySettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "socialMatchingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "citySceneDiscoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "agentPlaybackTrainingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recommendationExplanationPreference" TEXT NOT NULL DEFAULT 'balanced',
    "resetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListenerTasteMemorySettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListenerTasteSignalControl" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'hidden',
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListenerTasteSignalControl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListenerTasteMemorySettings_userId_key" ON "ListenerTasteMemorySettings"("userId");
CREATE INDEX "ListenerTasteMemorySettings_userId_resetAt_idx" ON "ListenerTasteMemorySettings"("userId", "resetAt");

CREATE UNIQUE INDEX "ListenerTasteSignalControl_userId_signalType_value_key" ON "ListenerTasteSignalControl"("userId", "signalType", "value");
CREATE INDEX "ListenerTasteSignalControl_userId_action_idx" ON "ListenerTasteSignalControl"("userId", "action");
CREATE INDEX "ListenerTasteSignalControl_signalType_value_idx" ON "ListenerTasteSignalControl"("signalType", "value");

ALTER TABLE "ListenerTasteMemorySettings"
    ADD CONSTRAINT "ListenerTasteMemorySettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListenerTasteSignalControl"
    ADD CONSTRAINT "ListenerTasteSignalControl_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
