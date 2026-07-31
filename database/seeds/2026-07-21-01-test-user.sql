-- 2026-07-21-01-test-user.sql
-- Local/dev test account for manual QA against the mobile app.
-- Credentials: username "testuser" / password "TestHavit123!"
-- password_hash below is bcrypt(10) of that password.

INSERT INTO havit.users (username, email, password_hash, is_active)
VALUES (
  'testuser',
  'testuser@havit.dev',
  '$2b$10$Ht61e9ROpWJEXo7UXTje7.jXuJGo5d1L3R1JNXLUk01rcMnWSdqcG',
  TRUE
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO havit.user_profiles (user_id, display_name, preferred_language, is_private)
SELECT id, 'Test User', 'es', FALSE
FROM havit.users
WHERE username = 'testuser'
ON CONFLICT (user_id) DO NOTHING;

