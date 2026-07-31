-- 2026-07-17-02-challenge-category-location-map.sql
-- Challenge creation (ChallengesService.create) accepts `categories`/`locations`
-- on the payload but had no table to persist them into, so they were silently
-- dropped and the frontend could never derive an activity color for a challenge.
-- Reuses the existing exercise_categories/exercise_locations catalogs (per project
-- decision: no new category/location catalog) via simple many-to-many map tables,
-- the same pattern already used for exercise_category_map/exercise_location_map.

CREATE TABLE IF NOT EXISTS havit.challenge_category_map (
  challenge_id UUID NOT NULL,
  category_id INT NOT NULL,
  PRIMARY KEY (challenge_id, category_id),
  CONSTRAINT fk_challenge_category_map_challenge
    FOREIGN KEY (challenge_id) REFERENCES havit.challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_category_map_category
    FOREIGN KEY (category_id) REFERENCES havit.exercise_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS havit.challenge_location_map (
  challenge_id UUID NOT NULL,
  location_id INT NOT NULL,
  PRIMARY KEY (challenge_id, location_id),
  CONSTRAINT fk_challenge_location_map_challenge
    FOREIGN KEY (challenge_id) REFERENCES havit.challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_challenge_location_map_location
    FOREIGN KEY (location_id) REFERENCES havit.exercise_locations(id) ON DELETE CASCADE
);

COMMENT ON TABLE havit.challenge_category_map IS 'Categorías (reusa exercise_categories) asociadas a un challenge, elegidas en el paso "categories" del builder.';
COMMENT ON TABLE havit.challenge_location_map IS 'Ubicaciones (reusa exercise_locations) asociadas a un challenge, elegidas en el paso "categories" del builder.';
