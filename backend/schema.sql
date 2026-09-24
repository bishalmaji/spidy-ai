CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    nickname      TEXT NOT NULL,
    gender        TEXT NOT NULL CHECK (gender IN ('male', 'female', 'neutral')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per logged-in device/browser. Deleting a row = logging out that device.
CREATE TABLE IF NOT EXISTS auth_tokens (
    token         TEXT PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

-- One "active" conversation per registered user; guests get a fresh
-- (immediately-closed) row every visit, never resumed.
CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    guest_device_id TEXT,                 -- set only for guest rows; user_id is NULL
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    CHECK (
      (user_id IS NOT NULL AND guest_device_id IS NULL) OR
      (user_id IS NULL AND guest_device_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_active
  ON conversations(user_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS messages (
    id               BIGSERIAL PRIMARY KEY,
    conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content          TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- Confirmed, promoted facts the AI actually uses in the system prompt.
CREATE TABLE IF NOT EXISTS user_facts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fact_text         TEXT NOT NULL,
    source            TEXT NOT NULL CHECK (source IN ('explicit', 'repeated')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reinforced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_facts_user ON user_facts(user_id);

-- Candidate topics seen in conversation, promoted to user_facts once they
-- recur often enough (see section 6). Never shown to the AI directly.
CREATE TABLE IF NOT EXISTS fact_candidates (
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    normalized_text   TEXT NOT NULL,
    raw_text          TEXT NOT NULL,
    occurrence_count  INTEGER NOT NULL DEFAULT 1,
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, normalized_text)
);
