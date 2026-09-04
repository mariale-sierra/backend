-- 2026-09-03-02-seed-muscle-svg-parts.sql
-- The full muscle -> muscle_mapper (minimal style, front+back) coverage matrix, built by
-- reading the real SVG files (lib/src/assets/minimal/male_{front,back}_muscle_anatomy.svg,
-- commit 8350dcaea79cd1013a140887ae4f0a3369bc4b73) and cross-referencing every <g id> against
-- the 29-muscle taxonomy. 12 exact, 7 grouped (multiple sub-parts combine into the full muscle),
-- 3 partial (available part only approximates/overlaps), 7 unavailable (is_fallback=true rows,
-- borrowing a neighboring muscle's path as a visual approximation — muscle_id always still
-- points at the real muscle; only the drawing is borrowed).
--
-- `side` is left at its table default ('center') throughout: the minimal style has no _l/_r
-- naming convention (unlike muscle_mapper's `advanced` style) — each <g> is a single path
-- representing the muscle across both sides of the body.

INSERT INTO havit.muscle_svg_parts (muscle_id, view, svg_part_id, coverage, is_fallback, notes)
SELECT m.id, v.view::havit.svg_view_enum, v.svg_part_id, v.coverage::havit.svg_coverage_enum,
       v.is_fallback, v.notes
FROM (VALUES
  -- chest
  ('pectoralis_major', 'front', 'upper-pectoralis', 'grouped', false, NULL),
  ('pectoralis_major', 'front', 'mid-lower-pectoralis', 'grouped', false, NULL),
  ('serratus_anterior', 'front', 'mid-lower-pectoralis', 'unavailable', true, 'No dedicated path in minimal (ribcage-side muscle). Fallback: nearby pectoral region.'),
  -- back
  ('latissimus_dorsi', 'back', 'lats', 'exact', false, NULL),
  ('trapezius', 'front', 'upper-trapezius', 'grouped', false, NULL),
  ('trapezius', 'back', 'upper-trapezius', 'grouped', false, NULL),
  ('trapezius', 'back', 'traps-middle', 'grouped', false, NULL),
  ('trapezius', 'back', 'lower-trapezius', 'grouped', false, NULL),
  ('rhomboids', 'back', 'traps-middle', 'unavailable', true, 'No dedicated path (between shoulder blades). Fallback: nearby mid-trapezius region.'),
  ('erector_spinae', 'back', 'lowerback', 'partial', false, 'Covers only the lumbar portion, not the full thoracic extent.'),
  -- shoulders
  ('anterior_deltoid', 'front', 'anterior-deltoid', 'exact', false, NULL),
  ('lateral_deltoid', 'front', 'lateral-deltoid', 'exact', false, NULL),
  ('lateral_deltoid', 'back', 'lateral-deltoid', 'exact', false, NULL),
  ('posterior_deltoid', 'back', 'posterior-deltoid', 'exact', false, NULL),
  ('supraspinatus', 'back', 'posterior-deltoid', 'unavailable', true, 'Deep rotator-cuff muscle, not representable in a flat style. Fallback: nearby posterior shoulder region.'),
  -- upper_arms
  ('biceps_brachii', 'front', 'long-head-bicep', 'grouped', false, NULL),
  ('biceps_brachii', 'front', 'short-head-bicep', 'grouped', false, NULL),
  ('triceps_brachii', 'back', 'long-head-triceps', 'grouped', false, NULL),
  ('triceps_brachii', 'back', 'lateral-head-triceps', 'grouped', false, NULL),
  ('triceps_brachii', 'back', 'medial-head-triceps', 'grouped', false, NULL),
  ('brachialis', 'front', 'long-head-bicep', 'unavailable', true, 'Sits under biceps, minimal does not separate it. Fallback: biceps region.'),
  ('brachialis', 'front', 'short-head-bicep', 'unavailable', true, 'Sits under biceps, minimal does not separate it. Fallback: biceps region.'),
  -- lower_arms
  ('brachioradialis', 'front', 'wrist-extensors', 'partial', false, 'Radial/extensor-side forearm muscle; wrist-extensors is the closest available group, not an exact match.'),
  ('brachioradialis', 'back', 'wrist-extensors', 'partial', false, 'Radial/extensor-side forearm muscle; wrist-extensors is the closest available group, not an exact match.'),
  ('forearm_flexors', 'front', 'wrist-flexors', 'exact', false, NULL),
  ('forearm_flexors', 'back', 'wrist-flexors', 'exact', false, NULL),
  ('forearm_extensors', 'front', 'wrist-extensors', 'exact', false, NULL),
  ('forearm_extensors', 'back', 'wrist-extensors', 'exact', false, NULL),
  -- core
  ('rectus_abdominis', 'front', 'upper-abdominals', 'grouped', false, NULL),
  ('rectus_abdominis', 'front', 'lower-abdominals', 'grouped', false, NULL),
  ('obliques', 'front', 'obliques', 'exact', false, NULL),
  ('transverse_abdominis', 'front', 'lower-abdominals', 'unavailable', true, 'Deep core muscle beneath rectus/obliques, not visible in a flat illustration. Fallback: lower-abdominal region.'),
  ('quadratus_lumborum', 'back', 'lowerback', 'unavailable', true, 'Deep lower-back muscle. Fallback: same lower-back region as erector spinae.'),
  -- upper_legs (incl. hip_flexors)
  ('hip_flexors', 'front', 'groin', 'partial', false, 'Groin region is the closest visible approximation, not an exact anatomical match.'),
  ('quadriceps', 'front', 'outer-quadricep', 'grouped', false, NULL),
  ('quadriceps', 'front', 'rectus-femoris', 'grouped', false, NULL),
  ('quadriceps', 'front', 'inner-quadricep', 'grouped', false, NULL),
  ('hamstrings', 'back', 'lateral-hamstrings', 'grouped', false, NULL),
  ('hamstrings', 'back', 'medial-hamstrings', 'grouped', false, NULL),
  ('gluteus_maximus', 'back', 'gluteus-maximus', 'exact', false, NULL),
  ('gluteus_medius', 'back', 'gluteus-medius', 'exact', false, NULL),
  ('adductors', 'front', 'inner-thigh', 'exact', false, NULL),
  ('adductors', 'back', 'inner-thigh', 'exact', false, NULL),
  ('abductors', 'back', 'gluteus-medius', 'unavailable', true, 'No dedicated path in minimal. Fallback: gluteus medius, the most significant hip abductor.'),
  -- lower_legs
  ('gastrocnemius', 'front', 'gastrocnemius', 'exact', false, NULL),
  ('gastrocnemius', 'back', 'gastrocnemius', 'exact', false, NULL),
  ('soleus', 'front', 'soleus', 'exact', false, NULL),
  ('soleus', 'back', 'soleus', 'exact', false, NULL)
) AS v(muscle_code, view, svg_part_id, coverage, is_fallback, notes)
JOIN havit.muscles m ON m.code = v.muscle_code
ON CONFLICT (muscle_id, view, side, svg_part_id) DO NOTHING;
