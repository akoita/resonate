-- Phase 0 OLTP schema draft based on docs/phase0/data_model_storage_plan.md

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE wallets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  address TEXT NOT NULL UNIQUE,
  chain_id INTEGER NOT NULL,
  balance_usd NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE artists (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  payout_address TEXT NOT NULL
);

CREATE TABLE tracks (
  id UUID PRIMARY KEY,
  artist_id UUID NOT NULL REFERENCES artists(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE stems (
  id UUID PRIMARY KEY,
  track_id UUID NOT NULL REFERENCES tracks(id),
  type TEXT NOT NULL,
  uri TEXT NOT NULL,
  ipnft_id TEXT,
  checksum TEXT
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  budget_cap_usd NUMERIC(12, 2) NOT NULL,
  spent_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP
);

CREATE TABLE licenses (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id),
  track_id UUID NOT NULL REFERENCES tracks(id),
  type TEXT NOT NULL,
  price_usd NUMERIC(12, 2) NOT NULL,
  duration_seconds INTEGER NOT NULL
);

CREATE TABLE payments (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id),
  tx_hash TEXT,
  amount_usd NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL
);
