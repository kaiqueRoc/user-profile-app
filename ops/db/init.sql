-- Simple schema for users, profiles, posts, likes
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  avatar_url TEXT,
  followers_count INT DEFAULT 0,
  following_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- retrocompat: ensure deleted_at exists (for older containers where table already created without the column)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- retro add columns for counts if missing
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS followers_count INT DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS following_count INT DEFAULT 0;

CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB,
  read boolean DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- === follower/following counters maintenance ===
CREATE OR REPLACE FUNCTION inc_follow_counts() RETURNS TRIGGER AS $$
DECLARE
  follower_profile_id TEXT;
  followee_profile_id TEXT;
BEGIN
  SELECT id INTO follower_profile_id FROM profiles WHERE user_id = NEW.follower_id LIMIT 1;
  SELECT id INTO followee_profile_id FROM profiles WHERE user_id = NEW.followee_id LIMIT 1;
  IF follower_profile_id IS NOT NULL THEN
    UPDATE profiles SET following_count = following_count + 1, updated_at=NOW() WHERE id = follower_profile_id;
  END IF;
  IF followee_profile_id IS NOT NULL THEN
    UPDATE profiles SET followers_count = followers_count + 1, updated_at=NOW() WHERE id = followee_profile_id;
  END IF;
  RETURN NEW;
END;$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dec_follow_counts() RETURNS TRIGGER AS $$
DECLARE
  follower_profile_id TEXT;
  followee_profile_id TEXT;
BEGIN
  SELECT id INTO follower_profile_id FROM profiles WHERE user_id = OLD.follower_id LIMIT 1;
  SELECT id INTO followee_profile_id FROM profiles WHERE user_id = OLD.followee_id LIMIT 1;
  IF follower_profile_id IS NOT NULL THEN
    UPDATE profiles SET following_count = GREATEST(following_count - 1,0), updated_at=NOW() WHERE id = follower_profile_id;
  END IF;
  IF followee_profile_id IS NOT NULL THEN
    UPDATE profiles SET followers_count = GREATEST(followers_count - 1,0), updated_at=NOW() WHERE id = followee_profile_id;
  END IF;
  RETURN OLD;
END;$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_follows_insert ON follows;
CREATE TRIGGER trg_follows_insert AFTER INSERT ON follows FOR EACH ROW EXECUTE FUNCTION inc_follow_counts();
DROP TRIGGER IF EXISTS trg_follows_delete ON follows;
CREATE TRIGGER trg_follows_delete AFTER DELETE ON follows FOR EACH ROW EXECUTE FUNCTION dec_follow_counts();
