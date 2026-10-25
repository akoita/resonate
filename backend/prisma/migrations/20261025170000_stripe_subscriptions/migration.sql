-- #2407 (Artist Pro slice 2): Stripe subscriptions in test mode. Additive: two
-- new tables and four enums; no existing value changes. Under policy
-- `entitlements/v1` (`everyone`) an active subscription is recorded in each
-- entitlement decision but changes nothing a person can do.

-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('stripe');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('pro');

-- CreateEnum
CREATE TYPE "SubscriptionInterval" AS ENUM ('month', 'year');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "SubscriptionProvider" NOT NULL DEFAULT 'stripe',
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'pro',
    "interval" "SubscriptionInterval" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'incomplete',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pastDueSince" TIMESTAMP(3),
    "lastEventCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "StripeEvent_receivedAt_idx" ON "StripeEvent"("receivedAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
