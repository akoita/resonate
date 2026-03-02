-- Manual migration: Column-level access restriction for agentPrivateKey
-- Purpose: Restrict which DB roles can read the encrypted private key column.
-- The main application role retains full access; a secondary readonly role is
-- created for dashboards, analytics, and read-only replicas.
--
-- This migration should be run manually by a DBA or via a privileged connection.
-- Prisma does not manage DB roles.
--
-- Usage:
--   psql -U postgres -d resonate -f restrict_agent_key_column.sql
-- 1. Create a readonly role for non-sensitive operations (if it doesn't exist)
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'app_readonly'
) THEN CREATE ROLE app_readonly;
END IF;
END $$;
-- 2. Grant SELECT on all tables to the readonly role
GRANT USAGE ON SCHEMA public TO app_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO app_readonly;
-- 3. REVOKE access to the sensitive column
-- The readonly role can SELECT all columns EXCEPT agentPrivateKey
REVOKE
SELECT ("agentPrivateKey") ON "SessionKey"
FROM app_readonly;
-- 4. Verify: readonly role should NOT be able to:
--   SELECT "agentPrivateKey" FROM "SessionKey";
-- But CAN:
--   SELECT id, "userId", "agentAddress", "approvalData" FROM "SessionKey";