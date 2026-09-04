-- 2026-09-03-01-seed-muscle-regions-and-muscles.sql
-- The 9 muscle_regions (exact match to RepDB's real `body_part` vocabulary, verified against
-- the full dataset) and 29 muscles (union of RepDB's real primary_muscles + secondary_muscles
-- vocabulary, with the 'forearms' outlier normalized into forearm_flexors + forearm_extensors
-- instead of becoming its own row). hip_flexors lives under upper_legs, not core — moved there
-- deliberately (muscle_mapper's own 'groin' SVG group sits physically clustered with
-- inner-thigh/outer-quadricep/rectus-femoris, i.e. the upper_legs region, reinforcing the move).

INSERT INTO havit.muscle_regions (code, name, sort_order, is_active) VALUES
  ('chest', 'Chest', 1, true),
  ('back', 'Back', 2, true),
  ('shoulders', 'Shoulders', 3, true),
  ('upper_arms', 'Upper Arms', 4, true),
  ('lower_arms', 'Lower Arms', 5, true),
  ('core', 'Core', 6, true),
  ('upper_legs', 'Upper Legs', 7, true),
  ('lower_legs', 'Lower Legs', 8, true),
  ('full_body', 'Full Body', 9, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO havit.muscles (region_id, code, name, sort_order, is_active)
SELECT mr.id, m.code, m.name, m.sort_order, true
FROM (VALUES
  -- chest
  ('chest', 'pectoralis_major', 'Pectoralis Major', 1),
  ('chest', 'serratus_anterior', 'Serratus Anterior', 2),
  -- back
  ('back', 'latissimus_dorsi', 'Latissimus Dorsi', 1),
  ('back', 'trapezius', 'Trapezius', 2),
  ('back', 'rhomboids', 'Rhomboids', 3),
  ('back', 'erector_spinae', 'Erector Spinae', 4),
  -- shoulders
  ('shoulders', 'anterior_deltoid', 'Anterior Deltoid', 1),
  ('shoulders', 'lateral_deltoid', 'Lateral Deltoid', 2),
  ('shoulders', 'posterior_deltoid', 'Posterior Deltoid', 3),
  ('shoulders', 'supraspinatus', 'Supraspinatus', 4),
  -- upper_arms
  ('upper_arms', 'biceps_brachii', 'Biceps Brachii', 1),
  ('upper_arms', 'triceps_brachii', 'Triceps Brachii', 2),
  ('upper_arms', 'brachialis', 'Brachialis', 3),
  -- lower_arms
  ('lower_arms', 'brachioradialis', 'Brachioradialis', 1),
  ('lower_arms', 'forearm_flexors', 'Forearm Flexors', 2),
  ('lower_arms', 'forearm_extensors', 'Forearm Extensors', 3),
  -- core
  ('core', 'rectus_abdominis', 'Rectus Abdominis', 1),
  ('core', 'obliques', 'Obliques', 2),
  ('core', 'transverse_abdominis', 'Transverse Abdominis', 3),
  ('core', 'quadratus_lumborum', 'Quadratus Lumborum', 4),
  -- upper_legs (includes hip_flexors, moved here from core)
  ('upper_legs', 'quadriceps', 'Quadriceps', 1),
  ('upper_legs', 'hamstrings', 'Hamstrings', 2),
  ('upper_legs', 'gluteus_maximus', 'Gluteus Maximus', 3),
  ('upper_legs', 'gluteus_medius', 'Gluteus Medius', 4),
  ('upper_legs', 'adductors', 'Adductors', 5),
  ('upper_legs', 'abductors', 'Abductors', 6),
  ('upper_legs', 'hip_flexors', 'Hip Flexors', 7),
  -- lower_legs
  ('lower_legs', 'gastrocnemius', 'Gastrocnemius', 1),
  ('lower_legs', 'soleus', 'Soleus', 2)
) AS m(region_code, code, name, sort_order)
JOIN havit.muscle_regions mr ON mr.code = m.region_code
ON CONFLICT (code) DO NOTHING;
