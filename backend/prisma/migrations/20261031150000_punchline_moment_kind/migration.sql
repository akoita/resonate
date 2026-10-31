-- #1476 slice 2: a moment's kind (punchline, crescendo, hook, solo) drives card
-- and copy flavour. Additive; every existing moment stays a punchline.
ALTER TABLE "PunchlineMoment" ADD COLUMN "momentKind" TEXT NOT NULL DEFAULT 'punchline';
