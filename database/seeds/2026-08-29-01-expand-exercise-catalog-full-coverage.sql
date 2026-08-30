-- 2026-08-29-01-expand-exercise-catalog-full-coverage.sql
-- Second pass on the exercise catalog (see 2026-08-28-01-expand-exercise-catalog.sql
-- for the first, which covered the 5 previously-empty categories with 2
-- exercises each). This pass widens coverage across BOTH dimensions —
-- activity category and location — rather than just filling category gaps:
-- the first pass left every non-Strength exercise clustered on 1-2 locations
-- (e.g. every Flexibility exercise was 'Anywhere', every Functional exercise
-- was 'Gym'), so a location-scoped browse/filter still looked thin even
-- though every category technically had entries.
--
-- 17 new exercises: 3 each for Cardio Intense/Cardio Low/Flexibility/
-- Mind-Body/Functional (15), plus 2 more Strength ones specifically to give
-- Strength some location variety beyond 'Anywhere' (it had 10 of its 12 rows
-- there). Deliberately spread across all 6 real locations (verified this
-- session via direct query: gym, home, outdoor, studio, home-outdoor,
-- cualquier-lugar/'Anywhere') so no location is left with zero coverage
-- outside Strength.
--
-- Same conventions as the first pass: metric_types by their REAL codes
-- (reps/weight/time/distance — not the 'distanceKm'/'duration' the first
-- pass's own follow-up fix, 2026-08-28-03, had to correct), full chain per
-- exercise (exercises row, primary category, primary location,
-- exercise_metrics), idempotent (ON CONFLICT-safe throughout).

INSERT INTO havit.exercises (name, slug, description, instructions, tracking_mode, is_active) VALUES
  -- Cardio Intense
  ('Rowing Intervals', 'rowing-intervals',
   'High-effort rowing machine intervals for full-body conditioning.',
   'Row hard for 250-500m or 30-45 seconds, then rest 60-90 seconds at an easy paddle. Repeat for the prescribed number of intervals, keeping form (legs-back-arms) consistent even as fatigue sets in.',
   'interval', true),
  ('Stair Climber Intervals', 'stair-climber-intervals',
   'Fast bodyweight stair repeats for a high-intensity, equipment-free cardio hit.',
   'Climb a flight of stairs quickly for 20-30 seconds, then walk back down slowly to recover. Repeat for the prescribed number of intervals.',
   'interval', true),
  ('HIIT Circuit', 'hiit-circuit',
   'A mixed-movement high-intensity interval circuit, typically done in a class setting.',
   'Cycle through short (30-45 second) bursts of high-effort movement separated by brief rest, following the instructor or a set circuit. Push close to max effort during each work interval.',
   'interval', true),

  -- Cardio Low
  ('Recovery Walk', 'recovery-walk',
   'A slow, easy walk indoors — recovery-pace cardio with zero impact.',
   'Walk at a relaxed, easy pace for the full duration. Effort should stay low enough that breathing is completely unaffected — this is about recovery, not conditioning.',
   'single', true),
  ('Low-Impact Cardio Class', 'low-impact-cardio-class',
   'A guided, low-impact cardio class — steady effort with joint-friendly movement patterns.',
   'Follow the instructor through low-impact cardio movement patterns at a steady, sustainable effort for the full class duration.',
   'single', true),
  ('Easy Jog', 'easy-jog',
   'A relaxed, conversational-pace jog — the low-intensity end of running.',
   'Jog at a pace where you can comfortably hold a conversation. Keep the effort steady and easy for the full duration rather than pushing the pace.',
   'single', true),

  -- Flexibility
  ('Foam Rolling', 'foam-rolling',
   'Self-myofascial release using a foam roller to loosen tight muscles.',
   'Roll slowly over each major muscle group for 30-60 seconds, pausing on tender spots for a few extra breaths. Avoid rolling directly over joints.',
   'single', true),
  ('Full Body Stretch Routine', 'full-body-stretch-routine',
   'A head-to-toe static stretching sequence you can do at home with no equipment.',
   'Move through a sequence of static stretches covering the major muscle groups (calves, hamstrings, hips, chest, shoulders), holding each for 20-30 seconds per side.',
   'single', true),
  ('Partner Assisted Stretch', 'partner-assisted-stretch',
   'Deeper static stretching with a partner or trainer applying gentle overpressure.',
   'Relax into each stretch while your partner applies slow, gentle pressure to deepen the range of motion. Communicate constantly — this should feel like a stretch, never pain.',
   'single', true),

  -- Mind-Body
  ('Meditation Session', 'meditation-session',
   'A seated mindfulness meditation practice.',
   'Sit comfortably with eyes closed. Bring attention to the breath, and gently return your focus to it each time the mind wanders, for the full duration.',
   'single', true),
  ('Tai Chi', 'tai-chi',
   'A slow, flowing sequence of martial-arts-derived movements focused on balance and control.',
   'Move slowly and continuously through the form, keeping weight shifts controlled and breathing relaxed. Prioritize smooth transitions between postures over speed.',
   'single', true),
  ('Mindful Cooldown', 'mindful-cooldown',
   'A slow, breath-focused cooldown to close out a gym session.',
   'After training, move through a few gentle stretches and controlled breathing for the prescribed duration, letting heart rate and effort settle before you leave.',
   'single', true),

  -- Functional
  ('Bodyweight Circuit', 'bodyweight-circuit',
   'A no-equipment circuit of bodyweight movements you can do at home.',
   'Cycle through a set of bodyweight movements (e.g. squats, push-ups, lunges) for the prescribed reps or rounds, resting briefly between rounds.',
   'sets', true),
  ('Sandbag Carry', 'sandbag-carry',
   'A loaded carry using a sandbag — builds grip, core, and full-body work capacity outdoors.',
   'Lift the sandbag with a neutral spine and carry it a set distance (or for a set number of reps of a fixed distance), keeping the core braced throughout. Set down with control, not a drop.',
   'sets', true),
  ('Functional Training Class', 'functional-training-class',
   'A guided class blending varied functional movement patterns — carries, lifts, throws.',
   'Follow the instructor through the prescribed movement patterns and rep scheme for each station, prioritizing movement quality over speed.',
   'sets', true),

  -- Strength (extra location variety — most existing Strength rows are 'Anywhere')
  ('Resistance Band Workout', 'resistance-band-workout',
   'A resistance-band strength session — an equipment-light alternative to free weights, done at home.',
   'Anchor or step on the band as needed for each movement, and perform the prescribed reps with slow, controlled tension on both the lifting and lowering phase.',
   'sets', true),
  ('Studio Strength Circuit', 'studio-strength-circuit',
   'A guided strength circuit in a studio class setting, typically using light dumbbells or bands.',
   'Move through each strength station for the prescribed reps, following the instructor pacing and form cues.',
   'sets', true)
ON CONFLICT (slug) DO NOTHING;

-- Primary category per new exercise.
INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary)
SELECT e.id, ec.id, true
FROM (VALUES
  ('rowing-intervals', 'cardio-intense'),
  ('stair-climber-intervals', 'cardio-intense'),
  ('hiit-circuit', 'cardio-intense'),
  ('recovery-walk', 'cardio-low'),
  ('low-impact-cardio-class', 'cardio-low'),
  ('easy-jog', 'cardio-low'),
  ('foam-rolling', 'flexibility'),
  ('full-body-stretch-routine', 'flexibility'),
  ('partner-assisted-stretch', 'flexibility'),
  ('meditation-session', 'mind-body'),
  ('tai-chi', 'mind-body'),
  ('mindful-cooldown', 'mind-body'),
  ('bodyweight-circuit', 'functional'),
  ('sandbag-carry', 'functional'),
  ('functional-training-class', 'functional'),
  ('resistance-band-workout', 'strength'),
  ('studio-strength-circuit', 'strength')
) AS mapping(exercise_slug, category_code)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.exercise_categories ec ON ec.code = mapping.category_code
ON CONFLICT (exercise_id, category_id) DO UPDATE SET is_primary = true;

-- Primary location per new exercise — deliberately spread across every real
-- location (gym, home, outdoor, studio, home-outdoor, cualquier-lugar) so no
-- location is left uncovered outside Strength.
INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary)
SELECT e.id, el.id, true
FROM (VALUES
  ('rowing-intervals', 'gym'),
  ('stair-climber-intervals', 'home'),
  ('hiit-circuit', 'studio'),
  ('recovery-walk', 'home'),
  ('low-impact-cardio-class', 'studio'),
  ('easy-jog', 'cualquier-lugar'),
  ('foam-rolling', 'gym'),
  ('full-body-stretch-routine', 'home'),
  ('partner-assisted-stretch', 'studio'),
  ('meditation-session', 'home'),
  ('tai-chi', 'home-outdoor'),
  ('mindful-cooldown', 'gym'),
  ('bodyweight-circuit', 'home'),
  ('sandbag-carry', 'outdoor'),
  ('functional-training-class', 'studio'),
  ('resistance-band-workout', 'home'),
  ('studio-strength-circuit', 'studio')
) AS mapping(exercise_slug, location_code)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.exercise_locations el ON el.code = mapping.location_code
ON CONFLICT (exercise_id, location_id) DO UPDATE SET is_primary = true;

-- Metrics per new exercise, matching ACTIVITY_METRIC_CONFIG in
-- frontend/types/metrics.ts, same convention as the first pass: cardio ->
-- time (primary, required) + distance (secondary, optional); flexibility/
-- mind-body -> time only; functional -> reps only (no 'rounds' metric_type
-- exists, not invented here); strength -> reps + weight, matching every
-- other Strength exercise in the catalog.
INSERT INTO havit.exercise_metrics (exercise_id, metric_type_id, is_required, is_primary, default_unit)
SELECT e.id, mt.id, mapping.is_required, mapping.is_primary, mt.default_unit
FROM (VALUES
  ('rowing-intervals', 'time', true, true),
  ('rowing-intervals', 'distance', false, false),
  ('stair-climber-intervals', 'time', true, true),
  ('stair-climber-intervals', 'distance', false, false),
  ('hiit-circuit', 'time', true, true),
  ('hiit-circuit', 'distance', false, false),
  ('recovery-walk', 'time', true, true),
  ('recovery-walk', 'distance', false, false),
  ('low-impact-cardio-class', 'time', true, true),
  ('low-impact-cardio-class', 'distance', false, false),
  ('easy-jog', 'time', true, true),
  ('easy-jog', 'distance', false, false),
  ('foam-rolling', 'time', true, true),
  ('full-body-stretch-routine', 'time', true, true),
  ('partner-assisted-stretch', 'time', true, true),
  ('meditation-session', 'time', true, true),
  ('tai-chi', 'time', true, true),
  ('mindful-cooldown', 'time', true, true),
  ('bodyweight-circuit', 'reps', true, true),
  ('sandbag-carry', 'reps', true, true),
  ('functional-training-class', 'reps', true, true),
  ('resistance-band-workout', 'reps', true, true),
  ('resistance-band-workout', 'weight', false, false),
  ('studio-strength-circuit', 'reps', true, true),
  ('studio-strength-circuit', 'weight', false, false)
) AS mapping(exercise_slug, metric_code, is_required, is_primary)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.metric_types mt ON mt.code = mapping.metric_code
ON CONFLICT (exercise_id, metric_type_id) DO UPDATE
  SET is_required = EXCLUDED.is_required, is_primary = EXCLUDED.is_primary;
