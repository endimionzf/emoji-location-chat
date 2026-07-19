-- Users Table
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255),
  is_admin BOOLEAN DEFAULT FALSE,
  avatar_url TEXT,
  invite_code VARCHAR(20) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW()
);

-- Emoji drops (reactions at locations)
CREATE TABLE emoji_drops (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(10) NOT NULL,
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  accuracy INT, -- GPS accuracy in meters
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP, -- Optional auto-expiry
  is_active BOOLEAN DEFAULT TRUE
);

-- Join requests
CREATE TABLE join_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  emoji_drop_id BIGINT REFERENCES emoji_drops(id) ON DELETE CASCADE,
  message TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, rejected
  created_at TIMESTAMP DEFAULT NOW(),
  responded_at TIMESTAMP,
  UNIQUE(requester_id, emoji_drop_id)
);

-- Chat messages (only between matched users in range)
CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY,
  join_request_id BIGINT REFERENCES join_requests(id) ON DELETE CASCADE,
  sender_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User locations (for range checks)
CREATE TABLE user_locations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  accuracy INT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Structured logs (all events)
CREATE TABLE logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  data JSONB,
  latitude FLOAT,
  longitude FLOAT,
  accuracy INT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create Indexes for Logs
CREATE INDEX idx_event_type ON logs (event_type);
CREATE INDEX idx_user_id ON logs (user_id);
CREATE INDEX idx_created_at ON logs (created_at);

-- Invites (for access control)
CREATE TABLE invites (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  created_by BIGINT REFERENCES users(id),
  used_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  used_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);

-- Pre-seed invite codes
INSERT INTO invites (code, is_active) VALUES 
('🔥👾🍕', TRUE),
('🌟🎒🎳', TRUE),
('🍺🌮🌈', TRUE);
