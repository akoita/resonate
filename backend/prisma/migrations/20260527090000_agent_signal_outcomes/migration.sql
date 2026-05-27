ALTER TABLE "AgentSignal" DROP CONSTRAINT IF EXISTS "AgentSignal_action_check";

ALTER TABLE "AgentSignal"
  ADD CONSTRAINT "AgentSignal_action_check"
  CHECK ("action" IN ('accept', 'skip', 'complete', 'save', 'replay', 'add_to_playlist', 'purchase'));
