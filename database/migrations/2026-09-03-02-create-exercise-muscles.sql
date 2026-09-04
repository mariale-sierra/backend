-- 2026-09-03-02-create-exercise-muscles.sql
-- Normalized exercise <-> muscle relation with a role (primary/secondary), replacing what would
-- otherwise be a JSON blob. Lets the app query directly: "exercises where biceps is primary",
-- "exercises where triceps is secondary", "exercises touching any shoulder muscle", etc.

CREATE TYPE havit.muscle_role_enum AS ENUM ('primary', 'secondary');

CREATE TABLE IF NOT EXISTS havit.exercise_muscles (
  exercise_id BIGINT NOT NULL,
  muscle_id BIGINT NOT NULL,
  role havit.muscle_role_enum NOT NULL,
  PRIMARY KEY (exercise_id, muscle_id),
  CONSTRAINT fk_exercise_muscles_exercise
    FOREIGN KEY (exercise_id) REFERENCES havit.exercises(id) ON DELETE CASCADE,
  CONSTRAINT fk_exercise_muscles_muscle
    FOREIGN KEY (muscle_id) REFERENCES havit.muscles(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_exercise_muscles_muscle_role ON havit.exercise_muscles(muscle_id, role);

COMMENT ON TABLE havit.exercise_muscles IS 'Which muscles an exercise works, and whether primary or secondary.';
