/**
 * Per-exercise metric assignment for the RepDB-imported catalog.
 *
 * Why this exists (2026-09-22): a category (Cardio Intense, Strength, Mind-Body, ...) is a
 * good first guess at what an exercise tracks, but it is not enough — inside one category the
 * right metrics genuinely differ: a plank and a barbell squat are both `strength`, a jump rope
 * and a treadmill run are both `cardio`. Worse, the importer never wrote any `exercise_metrics`
 * rows for RepDB exercises, and the backend rejects every logged metric an exercise has no
 * `exercise_metrics` row for ("Metric 'x' is not allowed for this exercise") — so logging reps /
 * time / distance against these exercises was failing silently.
 *
 * So every one of the 601 exercises is assigned a profile HERE, by id, individually reviewed
 * (against its force type, equipment and — for anything ambiguous — its own description text).
 * Nothing is inferred at import time: an id with no entry is a bug caught by
 * `exercise-metric-profiles.spec.ts`, which also fails when the vendored dataset gains an
 * exercise nobody has reviewed yet.
 *
 * The importer reads this table (tracking mode + `exercise_metrics` rows), and
 * `database/migrations/2026-09-22-02-assign-per-exercise-metrics.sql` applies the very same table to
 * the live database — the spec keeps the two from drifting.
 */

export type MetricCode = 'reps' | 'weight' | 'time' | 'distance';
export type MetricProfileName =
  | 'weighted_reps'
  | 'bodyweight_reps'
  | 'duration'
  | 'loaded_duration'
  | 'distance_duration';

export interface MetricSpec {
  /** `metric_types.code` (reps/weight are int/decimal, time is seconds, distance is km). */
  code: MetricCode;
  isRequired: boolean;
  isPrimary: boolean;
}

export interface MetricProfile {
  /** 'sets' -> the sets x reps editor; 'single' -> one value per metric (time/distance/...). */
  trackingMode: 'sets' | 'single';
  metrics: MetricSpec[];
}

export const METRIC_PROFILES: Record<MetricProfileName, MetricProfile> = {
  // Barbell / dumbbell / machine / cable lifts: reps are what's programmed, weight is what's lifted.
  weighted_reps: {
    trackingMode: 'sets',
    metrics: [
      { code: 'reps', isRequired: true, isPrimary: true },
      { code: 'weight', isRequired: false, isPrimary: false },
    ],
  },
  // Push-ups, pull-ups, crunches, band work, plyometrics, burpees: reps only, no load to log.
  bodyweight_reps: {
    trackingMode: 'sets',
    metrics: [{ code: 'reps', isRequired: true, isPrimary: true }],
  },
  // Planks, wall sits, dead hangs, yoga poses, static stretches, jump rope, stair climber: held / timed.
  duration: {
    trackingMode: 'single',
    metrics: [{ code: 'time', isRequired: true, isPrimary: true }],
  },
  // Farmer's walks, carries, plate pinch, sled work: how long, under how much weight.
  loaded_duration: {
    trackingMode: 'single',
    metrics: [
      { code: 'time', isRequired: true, isPrimary: true },
      { code: 'weight', isRequired: false, isPrimary: false },
    ],
  },
  // Running, walking, cycling, rowing, elliptical: time, plus the distance covered.
  distance_duration: {
    trackingMode: 'single',
    metrics: [
      { code: 'time', isRequired: true, isPrimary: true },
      { code: 'distance', isRequired: false, isPrimary: false },
    ],
  },
};

export const EXERCISE_METRIC_PROFILES: Record<string, MetricProfileName> = {
  // ── cardio · bodyweight_reps (2)
  'battle-rope-double-slam': 'bodyweight_reps', // Battle Rope Double Slam
  burpees: 'bodyweight_reps', // Burpees

  // ── cardio · duration (6)
  'battle-ropes': 'duration', // Battle Ropes
  'high-knees': 'duration', // High Knees
  'jump-rope': 'duration', // Jump Rope
  'jumping-jacks': 'duration', // Jumping Jacks
  'mountain-climbers': 'duration', // Mountain Climbers
  'stair-climber': 'duration', // Stair Climber

  // ── cardio · distance_duration (8)
  'air-bike': 'distance_duration', // Air Bike
  'elliptical-trainer': 'distance_duration', // Elliptical Trainer
  'incline-treadmill-walk': 'distance_duration', // Incline Treadmill Walk
  'rowing-machine': 'distance_duration', // Rowing Machine
  running: 'distance_duration', // Running
  'stationary-bike': 'distance_duration', // Stationary Bike
  'treadmill-running': 'distance_duration', // Treadmill Running
  walking: 'distance_duration', // Walking

  // ── plyometrics · bodyweight_reps (4)
  'box-jump': 'bodyweight_reps', // Box Jump
  'jump-squat': 'bodyweight_reps', // Jump Squat
  'plyo-lunge': 'bodyweight_reps', // Plyo Lunge
  'plyo-push-up': 'bodyweight_reps', // Plyo Push-Up

  // ── olympic · weighted_reps (14)
  clean: 'weighted_reps', // Clean
  'clean-and-jerk': 'weighted_reps', // Clean and Jerk
  'double-kettlebell-dead-clean': 'weighted_reps', // Double Kettlebell Dead Clean
  'double-kettlebell-dead-split-snatch': 'weighted_reps', // Double Kettlebell Dead Split Snatch
  'double-kettlebell-split-jerk': 'weighted_reps', // Double Kettlebell Split Jerk
  'double-kettlebell-swing-snatch': 'weighted_reps', // Double Kettlebell Swing Snatch
  'dumbbell-snatch': 'weighted_reps', // Dumbbell Snatch
  'hang-clean': 'weighted_reps', // Hang Clean
  'hang-power-clean': 'weighted_reps', // Hang Power Clean
  'kettlebell-swing-clean': 'weighted_reps', // Kettlebell Swing Clean
  'muscle-snatch': 'weighted_reps', // Muscle Snatch
  'push-jerk': 'weighted_reps', // Push Jerk
  snatch: 'weighted_reps', // Snatch
  'split-jerk': 'weighted_reps', // Split Jerk

  // ── stretching · bodyweight_reps (12)
  'cat-cow': 'bodyweight_reps', // Cat-Cow
  'downward-dog-pedal': 'bodyweight_reps', // Downward Dog Pedal
  'downward-dog-to-low-lunge': 'bodyweight_reps', // Downward Dog to Low Lunge
  'half-kneeling-hip-flexor-rock': 'bodyweight_reps', // Half-Kneeling Hip Flexor Rock
  'low-lunge-to-half-split': 'bodyweight_reps', // Low Lunge to Half Split
  'pilates-roll-down': 'bodyweight_reps', // Pilates Roll Down
  'pilates-saw': 'bodyweight_reps', // Pilates Saw
  'pilates-spine-stretch-forward': 'bodyweight_reps', // Pilates Spine Stretch Forward
  'pilates-spine-twist': 'bodyweight_reps', // Pilates Spine Twist
  'standing-forward-fold-to-half-lift': 'bodyweight_reps', // Standing Forward Fold to Half Lift
  'standing-side-bend-flow': 'bodyweight_reps', // Standing Side Bend Flow
  'thread-the-needle-flow': 'bodyweight_reps', // Thread the Needle Flow

  // ── stretching · duration (64)
  'banded-adductor-stretch': 'duration', // Banded Adductor Stretch
  'banded-ankle-stretch': 'duration', // Banded Ankle Stretch
  'banded-calf-stretch': 'duration', // Banded Calf Stretch
  'banded-chest-stretch': 'duration', // Banded Chest Stretch
  'banded-figure-4-stretch': 'duration', // Banded Figure-4 Stretch
  'banded-hamstring-stretch': 'duration', // Banded Hamstring Stretch
  'banded-it-band-stretch': 'duration', // Banded IT-Band Stretch
  'banded-lat-stretch': 'duration', // Banded Lat Stretch
  'banded-rear-delt-stretch': 'duration', // Banded Rear Delt Stretch
  'banded-shoulder-stretch': 'duration', // Banded Shoulder Stretch
  'banded-triceps-stretch': 'duration', // Banded Triceps Stretch
  'bench-adductor-stretch': 'duration', // Bench Adductor Stretch
  'bench-ankle-stretch': 'duration', // Bench Ankle Stretch
  'bench-bulgarian-split-stretch': 'duration', // Bench Bulgarian Split Stretch
  'bench-calf-stretch': 'duration', // Bench Calf Stretch
  'bench-chest-stretch': 'duration', // Bench Chest Stretch
  'bench-childs-pose': 'duration', // Bench Child's Pose
  'bench-couch-stretch': 'duration', // Bench Couch Stretch
  'bench-figure-4-glute-stretch': 'duration', // Bench Figure-4 Glute Stretch
  'bench-hamstring-stretch': 'duration', // Bench Hamstring Stretch
  'bench-lat-stretch': 'duration', // Bench Lat Stretch
  'butterfly-stretch': 'duration', // Butterfly Stretch
  'camel-pose': 'duration', // Camel Pose
  'cat-stretch': 'duration', // Cat Stretch
  'childs-pose': 'duration', // Child's Pose
  'cobra-stretch': 'duration', // Cobra Stretch
  'cow-face-pose': 'duration', // Cow Face Pose
  'cross-body-shoulder-stretch': 'duration', // Cross-Body Shoulder Stretch
  'doorway-chest-stretch': 'duration', // Doorway Chest Stretch
  'downward-dog': 'duration', // Downward-Facing Dog
  'easy-pose': 'duration', // Easy Pose
  'fish-pose': 'duration', // Fish Pose
  'garland-pose': 'duration', // Garland Pose
  'happy-baby': 'duration', // Happy Baby Pose
  'head-to-knee-pose': 'duration', // Head-to-Knee Pose
  'hero-pose': 'duration', // Hero Pose
  'knee-to-chest-stretch': 'duration', // Knee-to-Chest Stretch
  'kneeling-hip-flexor-stretch': 'duration', // Kneeling Hip Flexor Stretch
  'kneeling-wrist-stretch': 'duration', // Kneeling Wrist Stretch
  'legs-up-the-wall': 'duration', // Legs-Up-the-Wall Pose
  'lizard-stretch': 'duration', // Lizard Stretch
  'low-lunge': 'duration', // Low Lunge
  'mountain-pose': 'duration', // Mountain Pose
  'neck-side-stretch': 'duration', // Neck Side Stretch
  'overhead-triceps-stretch': 'duration', // Overhead Triceps Stretch
  'pigeon-stretch': 'duration', // Pigeon Stretch
  'plow-pose': 'duration', // Plow Pose
  'puppy-pose': 'duration', // Puppy Pose
  'pyramid-pose': 'duration', // Pyramid Pose
  savasana: 'duration', // Corpse Pose
  'seated-forward-fold': 'duration', // Seated Forward Fold
  'seated-spinal-twist': 'duration', // Seated Spinal Twist
  'seated-straddle-stretch': 'duration', // Seated Straddle Stretch
  'sphinx-pose': 'duration', // Sphinx Pose
  'standing-calf-stretch': 'duration', // Standing Calf Stretch
  'standing-forward-fold': 'duration', // Standing Forward Fold
  'standing-quad-stretch': 'duration', // Standing Quad Stretch
  'standing-side-bend': 'duration', // Standing Side Bend
  'standing-split': 'duration', // Standing Split
  'supine-spinal-twist': 'duration', // Supine Spinal Twist
  'thread-the-needle': 'duration', // Thread the Needle
  'triangle-pose': 'duration', // Triangle Pose
  'upward-dog': 'duration', // Upward-Facing Dog
  'wide-legged-forward-fold': 'duration', // Wide-Legged Forward Fold

  // ── strength · weighted_reps (297)
  'arnold-press': 'weighted_reps', // Arnold Press
  'assisted-dips': 'weighted_reps', // Machine Assisted Dips
  'assisted-pull-ups': 'weighted_reps', // Assisted Pull Ups
  'barbell-calf-raise': 'weighted_reps', // Barbell Calf Raise
  'barbell-curl': 'weighted_reps', // Barbell Curl
  'barbell-front-raise': 'weighted_reps', // Barbell Front Raise
  'barbell-glute-bridge': 'weighted_reps', // Barbell Glute Bridge
  'barbell-lunge': 'weighted_reps', // Barbell Lunge
  'barbell-overhead-extension': 'weighted_reps', // Barbell Overhead Extension
  'barbell-preacher-curl': 'weighted_reps', // Barbell Preacher Curl
  'barbell-pullover': 'weighted_reps', // Barbell Pullover
  'barbell-rear-delt-row': 'weighted_reps', // Barbell Rear Delt Row
  'barbell-reverse-lunge': 'weighted_reps', // Barbell Reverse Lunge
  'barbell-row': 'weighted_reps', // Bent-Over Barbell Row
  'barbell-wrist-curl': 'weighted_reps', // Barbell Wrist Curl
  'behind-the-back-barbell-shrug': 'weighted_reps', // Behind the Back Barbell Shrug
  'behind-the-neck-lat-pulldown': 'weighted_reps', // Behind-the-Neck Lat Pulldown
  'behind-the-neck-press': 'weighted_reps', // Behind the Neck Press
  'bench-press': 'weighted_reps', // Barbell Bench Press
  'bench-pull': 'weighted_reps', // Bench Pull
  'bent-arm-barbell-pullover': 'weighted_reps', // Bent Arm Barbell Pullover
  'bent-arm-ez-bar-pullover': 'weighted_reps', // Bent-Arm EZ-Bar Pullover
  'bent-over-db-row': 'weighted_reps', // Bent-Over Dumbbell Row
  'bent-over-ez-bar-row': 'weighted_reps', // Bent-Over EZ-Bar Row
  'bicep-curl': 'weighted_reps', // Dumbbell Bicep Curl
  'bulgarian-split-squat': 'weighted_reps', // Bulgarian Split Squat
  'cable-bent-over-row': 'weighted_reps', // Cable Bent-Over Row
  'cable-chest-press': 'weighted_reps', // Cable Chest Press
  'cable-crunch': 'weighted_reps', // Cable Crunch
  'cable-curl': 'weighted_reps', // Cable Curl
  'cable-external-rotation': 'weighted_reps', // Cable External Rotation
  'cable-fly': 'weighted_reps', // Cable Fly
  'cable-front-raise': 'weighted_reps', // Cable Front Raise
  'cable-hammer-curl': 'weighted_reps', // Cable Hammer Curl
  'cable-kickback': 'weighted_reps', // Cable Glute Kickback
  'cable-lateral-raise': 'weighted_reps', // Cable Lateral Raise
  'cable-pallof-press': 'weighted_reps', // Cable Pallof Press
  'cable-tricep-kickback': 'weighted_reps', // Cable Tricep Kickback
  'cable-upright-row': 'weighted_reps', // Cable Upright Row
  'cable-wrist-curl': 'weighted_reps', // Cable Wrist Curl
  'cheat-curl': 'weighted_reps', // Cheat Curl
  'chest-press-machine': 'weighted_reps', // Machine Chest Press
  'chest-supported-db-row': 'weighted_reps', // Chest-Supported Dumbbell Row
  'chest-supported-dumbbell-shrug': 'weighted_reps', // Chest Supported Dumbbell Shrug
  'chest-supported-kettlebell-row': 'weighted_reps', // Chest-Supported Kettlebell Row
  'chest-supported-smith-machine-row': 'weighted_reps', // Chest-Supported Smith Machine Row
  'close-grip-barbell-curl': 'weighted_reps', // Close-Grip Barbell Curl
  'close-grip-bench-press': 'weighted_reps', // Close-Grip Bench Press
  'close-grip-db-bench-press': 'weighted_reps', // Close-Grip Dumbbell Bench Press
  'close-grip-ez-bar-bench-press': 'weighted_reps', // Close-Grip EZ-Bar Bench Press
  'close-grip-ez-bar-curl': 'weighted_reps', // Close-Grip EZ-Bar Curl
  'close-grip-incline-bench': 'weighted_reps', // Close-Grip Incline Bench Press
  'close-grip-lat-pulldown': 'weighted_reps', // Close Grip Lat Pulldown
  'close-stance-leg-press': 'weighted_reps', // Close-Stance Leg Press
  'concentration-curl': 'weighted_reps', // Concentration Curl
  'cross-body-hammer-curl': 'weighted_reps', // Cross Body Hammer Curl
  'db-bench-press': 'weighted_reps', // Dumbbell Bench Press
  'db-fly': 'weighted_reps', // Dumbbell Fly
  'db-kickstand-deadlift': 'weighted_reps', // Dumbbell Kickstand Deadlift
  'db-lunge': 'weighted_reps', // Dumbbell Lunge
  'db-pullover': 'weighted_reps', // Dumbbell Pullover
  'db-reverse-curl': 'weighted_reps', // Dumbbell Reverse Curl
  'db-reverse-wrist-curl': 'weighted_reps', // Dumbbell Reverse Wrist Curl
  'db-shrug': 'weighted_reps', // Dumbbell Shrug
  'db-skull-crusher': 'weighted_reps', // Dumbbell Skull Crusher
  'db-somersault-squat': 'weighted_reps', // Dumbbell Somersault Squat
  'db-squat': 'weighted_reps', // Dumbbell Squat
  'db-sumo-squat': 'weighted_reps', // Dumbbell Sumo Squat
  'db-svend-press': 'weighted_reps', // Dumbbell Svend Press
  deadlift: 'weighted_reps', // Barbell Deadlift
  'decline-bench-press': 'weighted_reps', // Decline Bench Press
  'decline-bench-press-barbell': 'weighted_reps', // Decline Barbell Bench Press
  'decline-bench-press-ez-bar': 'weighted_reps', // Decline EZ-Bar Bench Press
  'decline-db-fly': 'weighted_reps', // Decline Dumbbell Fly
  'deficit-deadlift': 'weighted_reps', // Deficit Deadlift
  'double-db-kickstand-deadlift': 'weighted_reps', // Double Dumbbell Kickstand Deadlift
  'double-kettlebell-bicep-curl': 'weighted_reps', // Double Kettlebell Bicep Curl
  'double-kettlebell-clean': 'weighted_reps', // Double Kettlebell Clean
  'double-kettlebell-clean-and-press': 'weighted_reps', // Double Kettlebell Clean and Press
  'double-kettlebell-jerk': 'weighted_reps', // Double Kettlebell Jerk
  'double-kettlebell-overhead-press': 'weighted_reps', // Double Kettlebell Overhead Press
  'double-kettlebell-push-press': 'weighted_reps', // Double Kettlebell Push Press
  'double-kettlebell-rear-delt-row': 'weighted_reps', // Double Kettlebell Rear Delt Row
  'double-kettlebell-row': 'weighted_reps', // Double Kettlebell Row
  'drag-curl': 'weighted_reps', // Drag Curl
  'dumbbell-bench-pull': 'weighted_reps', // Dumbbell Bench Pull
  'dumbbell-calf-raise': 'weighted_reps', // Dumbbell Calf Raise
  'dumbbell-deadlift': 'weighted_reps', // Dumbbell Deadlift
  'dumbbell-face-pull': 'weighted_reps', // Dumbbell Face Pull
  'dumbbell-floor-press': 'weighted_reps', // Dumbbell Floor Press
  'dumbbell-front-raise': 'weighted_reps', // Dumbbell Front Raise
  'dumbbell-front-squat': 'weighted_reps', // Dumbbell Front Squat
  'dumbbell-hip-thrust': 'weighted_reps', // Dumbbell Hip Thrust
  'dumbbell-pistol-squat': 'weighted_reps', // Dumbbell Pistol Squat
  'dumbbell-push-press': 'weighted_reps', // Dumbbell Push Press
  'dumbbell-reverse-fly': 'weighted_reps', // Dumbbell Reverse Fly
  'dumbbell-romanian-deadlift': 'weighted_reps', // Dumbbell Romanian Deadlift
  'dumbbell-shoulder-press': 'weighted_reps', // Dumbbell Shoulder Press
  'dumbbell-side-bend': 'weighted_reps', // Dumbbell Side Bend
  'dumbbell-split-squat': 'weighted_reps', // Dumbbell Split Squat
  'dumbbell-tricep-extension': 'weighted_reps', // Dumbbell Tricep Extension
  'dumbbell-upright-row': 'weighted_reps', // Dumbbell Upright Row
  'dumbbell-windmill': 'weighted_reps', // Dumbbell Windmill
  'dumbbell-wrist-curl': 'weighted_reps', // Dumbbell Wrist Curl
  'ez-bar-bench-press': 'weighted_reps', // EZ-Bar Bench Press
  'ez-bar-curl': 'weighted_reps', // EZ-Bar Curl
  'ez-bar-front-raise': 'weighted_reps', // EZ-Bar Front Raise
  'ez-bar-lying-tricep-extension': 'weighted_reps', // EZ-Bar Lying Triceps Extension
  'ez-bar-overhead-extension': 'weighted_reps', // EZ-Bar Overhead Tricep Extension
  'ez-bar-pullover': 'weighted_reps', // EZ Bar Pullover
  'ez-bar-reverse-curl': 'weighted_reps', // EZ-Bar Reverse Curl
  'ez-bar-reverse-grip-row': 'weighted_reps', // EZ Bar Reverse Grip Row
  'ez-bar-romanian-deadlift': 'weighted_reps', // EZ-Bar Romanian Deadlift
  'ez-bar-shrug': 'weighted_reps', // EZ-Bar Shrug
  'ez-bar-spider-curl': 'weighted_reps', // EZ Bar Spider Curl
  'ez-bar-upright-row': 'weighted_reps', // EZ-Bar Upright Row
  'ez-bar-wrist-curl': 'weighted_reps', // EZ-Bar Wrist Curl
  'face-pull': 'weighted_reps', // Cable Face Pull
  'floor-ez-bar-press': 'weighted_reps', // Floor EZ-Bar Press
  'floor-kettlebell-pullover': 'weighted_reps', // Floor Kettlebell Pullover
  'floor-press': 'weighted_reps', // Floor Press
  'front-squat': 'weighted_reps', // Front Squat
  'goblet-squat': 'weighted_reps', // Goblet Squat
  'good-morning': 'weighted_reps', // Good Morning
  'hack-squat': 'weighted_reps', // Hack Squat
  'hack-squat-calf-raise': 'weighted_reps', // Hack Squat Calf Raise
  'hammer-curl': 'weighted_reps', // Dumbbell Hammer Curl
  'heel-elevated-squat': 'weighted_reps', // Heel-Elevated Squat
  'hex-bar-deadlift': 'weighted_reps', // Hex Bar Deadlift
  'high-foot-leg-press': 'weighted_reps', // High-Foot Leg Press
  'hip-abduction': 'weighted_reps', // Machine Hip Abduction
  'hip-adduction': 'weighted_reps', // Hip Adduction
  'hip-thrust': 'weighted_reps', // Barbell Hip Thrust
  'horizontal-leg-press': 'weighted_reps', // Horizontal Leg Press
  'incline-bench-ez-bar-press': 'weighted_reps', // Incline EZ-Bar Bench Press
  'incline-bench-press': 'weighted_reps', // Incline Barbell Bench Press
  'incline-db-curl': 'weighted_reps', // Incline Dumbbell Curl
  'incline-db-press': 'weighted_reps', // Incline Dumbbell Press
  'incline-dumbbell-fly': 'weighted_reps', // Incline Dumbbell Fly
  'incline-hammer-curl': 'weighted_reps', // Incline Hammer Curl
  'jefferson-curl': 'weighted_reps', // Jefferson Curl
  'kettlebell-bulgarian-split-squat': 'weighted_reps', // Kettlebell Bulgarian Split Squat
  'kettlebell-close-grip-floor-press': 'weighted_reps', // Kettlebell Close-Grip Floor Press
  'kettlebell-concentration-curl': 'weighted_reps', // Kettlebell Concentration Curl
  'kettlebell-deadlift': 'weighted_reps', // Kettlebell Deadlift
  'kettlebell-floor-press': 'weighted_reps', // Kettlebell Floor Press
  'kettlebell-goblet-lunge': 'weighted_reps', // Kettlebell Goblet Lunge
  'kettlebell-halo': 'weighted_reps', // Kettlebell Halo
  'kettlebell-hammer-curl': 'weighted_reps', // Kettlebell Hammer Curl
  'kettlebell-hip-thrust': 'weighted_reps', // Kettlebell Hip Thrust
  'kettlebell-kickstand-deadlift': 'weighted_reps', // Kettlebell Kickstand Deadlift
  'kettlebell-lunge-press': 'weighted_reps', // Kettlebell Lunge Press
  'kettlebell-offset-reverse-lunge-and-press': 'weighted_reps', // Kettlebell Offset Reverse Lunge and Press
  'kettlebell-overhead-tricep-extension': 'weighted_reps', // Kettlebell Overhead Tricep Extension
  'kettlebell-pistol-squat': 'weighted_reps', // Kettlebell Pistol Squat
  'kettlebell-pullover': 'weighted_reps', // Kettlebell Pullover
  'kettlebell-reverse-lunge': 'weighted_reps', // Kettlebell Reverse Lunge
  'kettlebell-reverse-wrist-curl': 'weighted_reps', // Kettlebell Reverse Wrist Curl
  'kettlebell-rotational-lunge': 'weighted_reps', // Kettlebell Rotational Lunge
  'kettlebell-russian-twist': 'weighted_reps', // Kettlebell Russian Twist
  'kettlebell-shrug': 'weighted_reps', // Kettlebell Shrug
  'kettlebell-single-leg-deadlift': 'weighted_reps', // Kettlebell Single Leg Deadlift
  'kettlebell-skull-crusher': 'weighted_reps', // Kettlebell Skull Crusher
  'kettlebell-squat': 'weighted_reps', // Kettlebell Squat
  'kettlebell-sumo-deadlift': 'weighted_reps', // Kettlebell Sumo Deadlift
  'kettlebell-sumo-high-pull': 'weighted_reps', // Kettlebell Sumo High Pull
  'kettlebell-svend-press': 'weighted_reps', // Kettlebell Svend Press
  'kettlebell-swing': 'weighted_reps', // Kettlebell Swing
  'kettlebell-turkish-get-ups': 'weighted_reps', // Kettlebell Turkish Get Ups
  'kettlebell-windmills': 'weighted_reps', // Kettlebell Windmills
  'kettlebell-wrist-curl': 'weighted_reps', // Kettlebell Wrist Curl
  'kneeling-cable-row': 'weighted_reps', // Kneeling Cable Row
  'landmine-press': 'weighted_reps', // Landmine Press
  'lat-pulldown': 'weighted_reps', // Lat Pulldown
  'lateral-raise': 'weighted_reps', // Dumbbell Lateral Raise
  'leg-curl': 'weighted_reps', // Lying Leg Curl
  'leg-extension': 'weighted_reps', // Leg Extension
  'leg-press': 'weighted_reps', // Leg Press
  'lying-tricep-extension': 'weighted_reps', // Lying Tricep Extension
  'machine-back-extension': 'weighted_reps', // Machine Back Extension
  'machine-bicep-curl': 'weighted_reps', // Machine Bicep Curl
  'machine-calf-raise': 'weighted_reps', // Machine Calf Raise
  'machine-chest-fly': 'weighted_reps', // Machine Chest Fly
  'machine-preacher-curl': 'weighted_reps', // Machine Preacher Curl
  'machine-seated-crunch': 'weighted_reps', // Machine Seated Crunch
  'machine-shoulder-press': 'weighted_reps', // Machine Shoulder Press
  'machine-triceps-extension': 'weighted_reps', // Machine Triceps Extension
  'medicine-ball-slam': 'weighted_reps', // Medicine Ball Slam
  ohp: 'weighted_reps', // Barbell Overhead Press
  'one-arm-dumbbell-push-press': 'weighted_reps', // One-Arm Dumbbell Push Press
  'one-arm-dumbbell-swing': 'weighted_reps', // One-Arm Dumbbell Swing
  'one-arm-kettlebell-bicep-curl': 'weighted_reps', // One Arm Kettlebell Bicep Curl
  'one-arm-kettlebell-bottoms-up-press': 'weighted_reps', // One-Arm Kettlebell Bottoms-Up Press
  'one-arm-kettlebell-floor-glute-bridge-press': 'weighted_reps', // One Arm Kettlebell Floor Glute Bridge Press
  'one-arm-kettlebell-floor-press': 'weighted_reps', // One Arm Kettlebell Floor Press
  'one-arm-kettlebell-front-squat': 'weighted_reps', // One Arm Kettlebell Front Squat
  'one-arm-kettlebell-push-press': 'weighted_reps', // One Arm Kettlebell Push Press
  'one-arm-kettlebell-row': 'weighted_reps', // One Arm Kettlebell Row
  'one-arm-kettlebell-shoulder-press': 'weighted_reps', // One Arm Kettlebell Shoulder Press
  'one-arm-kettlebell-swing': 'weighted_reps', // One Arm Kettlebell Swing
  'one-arm-kettlebell-tricep-kickback': 'weighted_reps', // One-Arm Kettlebell Tricep Kickback
  'one-arm-landmine-press': 'weighted_reps', // One-Arm Landmine Press
  'one-arm-lat-pulldown': 'weighted_reps', // One-Arm Lat Pulldown
  'one-arm-single-leg-dumbbell-romanian-deadlift': 'weighted_reps', // One-Arm Single-Leg Dumbbell Romanian Deadlift
  'one-arm-single-leg-kettlebell-romanian-deadlift': 'weighted_reps', // One-Arm Single-Leg Kettlebell Romanian Deadlift
  'overhead-squat': 'weighted_reps', // Overhead Squat
  'overhead-tricep-extension': 'weighted_reps', // Overhead Tricep Extension
  'pause-deadlift': 'weighted_reps', // Pause Deadlift
  'pause-squat': 'weighted_reps', // Pause Squat
  'paused-bench-press': 'weighted_reps', // Paused Bench Press
  'paused-incline-bench-press': 'weighted_reps', // Paused Incline Bench Press
  'paused-ohp': 'weighted_reps', // Paused Overhead Press
  'pec-deck': 'weighted_reps', // Pec Deck
  'pendlay-row': 'weighted_reps', // Pendlay Row
  'plate-loaded-donkey-calf-raise': 'weighted_reps', // Plate-Loaded Donkey Calf Raise
  'plate-loaded-glute-drive': 'weighted_reps', // Plate-Loaded Glute Drive
  'plate-loaded-lateral-raise': 'weighted_reps', // Plate-Loaded Lateral Raise
  'plate-loaded-shrug': 'weighted_reps', // Plate-Loaded Shrug
  'plate-pullover': 'weighted_reps', // Plate Pullover
  'preacher-curl': 'weighted_reps', // Preacher Curl
  'preacher-hammer-curl': 'weighted_reps', // Preacher Hammer Curl
  'push-press': 'weighted_reps', // Push Press
  'rack-pull': 'weighted_reps', // Rack Pull
  'rear-delt-fly': 'weighted_reps', // Rear Delt Fly
  'reverse-curl': 'weighted_reps', // Reverse Curl
  'reverse-grip-bent-over-row': 'weighted_reps', // Reverse Grip Bent Over Row
  'reverse-grip-lat-pulldown': 'weighted_reps', // Reverse Grip Lat Pulldown
  'reverse-lunge': 'weighted_reps', // Reverse Lunge
  'romanian-deadlift': 'weighted_reps', // Romanian Deadlift
  'seated-barbell-overhead-press': 'weighted_reps', // Seated Barbell Overhead Press
  'seated-cable-row': 'weighted_reps', // Seated Cable Row
  'seated-calf-raise': 'weighted_reps', // Seated Calf Raise
  'seated-db-press': 'weighted_reps', // Seated Dumbbell Shoulder Press
  'seated-dumbbell-curl': 'weighted_reps', // Seated Dumbbell Curl
  'seated-dumbbell-lateral-raise': 'weighted_reps', // Seated Dumbbell Lateral Raise
  'seated-dumbbell-tricep-extension': 'weighted_reps', // Seated Dumbbell Tricep Extension
  'seated-leg-curl': 'weighted_reps', // Seated Leg Curl
  'seated-smith-machine-shoulder-press': 'weighted_reps', // Seated Smith Machine Shoulder Press
  shrug: 'weighted_reps', // Barbell Shrug
  'side-lying-lateral-raise': 'weighted_reps', // Side-Lying Lateral Raise
  'single-arm-chest-supported-dumbbell-row': 'weighted_reps', // Single-Arm Chest-Supported Dumbbell Row
  'single-arm-db-row': 'weighted_reps', // Single-Arm Dumbbell Row
  'single-arm-dumbbell-overhead-tricep-extension': 'weighted_reps', // Single-Arm Dumbbell Overhead Tricep Extension
  'single-arm-hammer-curl': 'weighted_reps', // Single-Arm Hammer Curl
  'single-arm-machine-shoulder-press': 'weighted_reps', // Single-Arm Machine Shoulder Press
  'single-arm-plate-loaded-lateral-raise': 'weighted_reps', // Single-Arm Plate-Loaded Lateral Raise
  'single-arm-tricep-pushdown': 'weighted_reps', // Single Arm Tricep Pushdown
  'single-db-svend-press': 'weighted_reps', // Single Dumbbell Svend Press
  'single-leg-extension': 'weighted_reps', // Single Leg Extension
  'single-leg-lying-leg-curl': 'weighted_reps', // Single Leg Lying Leg Curl
  'single-leg-press': 'weighted_reps', // Single Leg Press
  'single-leg-romanian-deadlift': 'weighted_reps', // Single Leg Romanian Deadlift
  'skull-crusher': 'weighted_reps', // Skull Crusher
  'smith-machine-bench-press': 'weighted_reps', // Smith Machine Bench Press
  'smith-machine-bent-over-row': 'weighted_reps', // Smith Machine Bent Over Row
  'smith-machine-bulgarian-split': 'weighted_reps', // Smith Machine Bulgarian Split Squat
  'smith-machine-calf-raise': 'weighted_reps', // Smith Machine Calf Raise
  'smith-machine-decline-bench-press': 'weighted_reps', // Smith Machine Decline Bench Press
  'smith-machine-front-squat': 'weighted_reps', // Smith Machine Front Squat
  'smith-machine-good-morning': 'weighted_reps', // Smith Machine Good Morning
  'smith-machine-hip-thrust': 'weighted_reps', // Smith Machine Hip Thrust
  'smith-machine-incline-bench-press': 'weighted_reps', // Smith Machine Incline Bench Press
  'smith-machine-rdl': 'weighted_reps', // Smith Machine Romanian Deadlift
  'smith-machine-reverse-grip-bent-over-row': 'weighted_reps', // Smith Machine Reverse Grip Bent Over Row
  'smith-machine-reverse-lunge': 'weighted_reps', // Smith Machine Reverse Lunge
  'smith-machine-shoulder-press': 'weighted_reps', // Smith Machine Shoulder Press
  'smith-machine-shrug': 'weighted_reps', // Smith Machine Shrug
  'smith-machine-split-squat': 'weighted_reps', // Smith Machine Split Squat
  'smith-machine-squat': 'weighted_reps', // Smith Machine Squat
  'smith-machine-upright-row': 'weighted_reps', // Smith Machine Upright Row
  'spider-curl': 'weighted_reps', // Spider Curl
  'spoto-press': 'weighted_reps', // Spoto Press
  squat: 'weighted_reps', // Barbell Back Squat
  'standing-calf-raise': 'weighted_reps', // Standing Calf Raise
  'stiff-leg-deadlift': 'weighted_reps', // Stiff Leg Deadlift
  'straight-arm-pulldown': 'weighted_reps', // Straight-Arm Pulldown
  'straight-bar-cable-front-raise': 'weighted_reps', // Straight-Bar Cable Front Raise
  'strict-curl': 'weighted_reps', // Strict Curl
  'sumo-deadlift': 'weighted_reps', // Sumo Deadlift
  'sumo-squat': 'weighted_reps', // Sumo Squat
  'svend-press': 'weighted_reps', // Svend Press
  't-bar-row': 'weighted_reps', // T-Bar Row
  thruster: 'weighted_reps', // Thruster
  'tricep-kickback': 'weighted_reps', // Dumbbell Tricep Kickback
  'tricep-pushdown': 'weighted_reps', // Cable Tricep Pushdown
  'upright-row': 'weighted_reps', // Barbell Upright Row
  'v-bar-lat-pulldown': 'weighted_reps', // V-Bar Lat Pulldown
  'v-bar-tricep-pushdown': 'weighted_reps', // V-Bar Tricep Pushdown
  'weighted-dips': 'weighted_reps', // Weighted Dips
  'weighted-pull-up': 'weighted_reps', // Weighted Pull-Up
  'weighted-wall-crunch': 'weighted_reps', // Weighted Wall Crunch
  'wide-grip-bench-press': 'weighted_reps', // Wide-Grip Bench Press
  'wide-grip-seated-cable-row': 'weighted_reps', // Wide Grip Seated Cable Row
  'wide-stance-leg-press': 'weighted_reps', // Wide-Stance Leg Press
  'wrist-curl': 'weighted_reps', // Bilateral Dumbbell Wrist Curl
  'wrist-roller': 'weighted_reps', // Wrist Roller
  'zottman-curl': 'weighted_reps', // Zottman Curl

  // ── strength · bodyweight_reps (134)
  'ab-wheel-rollout': 'bodyweight_reps', // Ab Wheel Rollout
  'archer-pull-ups': 'bodyweight_reps', // Archer Pull Ups
  'archer-push-ups': 'bodyweight_reps', // Archer Push Ups
  'back-extension': 'bodyweight_reps', // Back Extension
  'ball-leg-curl': 'bodyweight_reps', // Stability Ball Leg Curl
  'ball-pike': 'bodyweight_reps', // Ball Pike
  'band-assisted-pull-ups': 'bodyweight_reps', // Band Assisted Pull Ups
  'band-pull-apart': 'bodyweight_reps', // Band Pull Apart
  'banded-clamshell': 'bodyweight_reps', // Banded Clamshell
  'banded-fire-hydrant': 'bodyweight_reps', // Banded Fire Hydrant
  'banded-glute-bridge': 'bodyweight_reps', // Banded Glute Bridge
  'banded-good-morning': 'bodyweight_reps', // Banded Good Morning
  'banded-hip-thrust': 'bodyweight_reps', // Banded Hip Thrust
  'banded-kneeling-hip-thrust': 'bodyweight_reps', // Banded Kneeling Hip Thrust
  'banded-lateral-walk': 'bodyweight_reps', // Banded Lateral Walk
  'banded-romanian-deadlift': 'bodyweight_reps', // Banded Romanian Deadlift
  'banded-seated-hip-abduction': 'bodyweight_reps', // Banded Seated Hip Abduction
  'banded-squat': 'bodyweight_reps', // Banded Squat
  'banded-standing-curl': 'bodyweight_reps', // Banded Standing Leg Curl
  'banded-standing-hip-abduction': 'bodyweight_reps', // Banded Standing Hip Abduction
  'banded-standing-hip-adduction': 'bodyweight_reps', // Banded Standing Hip Adduction
  'banded-sumo-walk': 'bodyweight_reps', // Banded Sumo Walk
  'banded-terminal-knee-extension': 'bodyweight_reps', // Banded Terminal Knee Extension
  'barbell-ab-rollout': 'bodyweight_reps', // Barbell Ab Rollout
  'behind-the-neck-pull-ups': 'bodyweight_reps', // Behind-the-Neck Pull-Up
  'bench-dips': 'bodyweight_reps', // Bench Dips
  'bench-leg-pull-in': 'bodyweight_reps', // Bench Leg Pull-In
  'bicycle-crunch': 'bodyweight_reps', // Bicycle Crunch
  'bird-dog': 'bodyweight_reps', // Bird-Dog
  'bodyweight-calf-raise': 'bodyweight_reps', // Bodyweight Calf Raise
  'bodyweight-good-morning': 'bodyweight_reps', // Bodyweight Good Morning
  'bodyweight-lateral-raise': 'bodyweight_reps', // Bodyweight Lateral Raise
  'bodyweight-overhead-press': 'bodyweight_reps', // Bodyweight Overhead Press
  'bodyweight-reverse-lunge': 'bodyweight_reps', // Bodyweight Reverse Lunge
  'bodyweight-squat': 'bodyweight_reps', // Bodyweight Squat
  'box-squat': 'bodyweight_reps', // Box Squat
  'captains-chair-knee-raise': 'bodyweight_reps', // Captain's Chair Knee Raise
  'captains-chair-leg-raise': 'bodyweight_reps', // Captain's Chair Leg Raise
  'chin-ups': 'bodyweight_reps', // Chin-Ups
  clamshells: 'bodyweight_reps', // Clamshells
  'clap-push-ups': 'bodyweight_reps', // Clap Push-Ups
  'close-grip-pull-ups': 'bodyweight_reps', // Close-Grip Pull-Ups
  'close-grip-push-ups': 'bodyweight_reps', // Close Grip Push Ups
  cocoons: 'bodyweight_reps', // Cocoons
  'cossack-squat': 'bodyweight_reps', // Cossack Squat
  'crab-dips': 'bodyweight_reps', // Crab Dips
  'cross-body-crunch': 'bodyweight_reps', // Cross-Body Crunch
  crunches: 'bodyweight_reps', // Crunches
  'dead-bug': 'bodyweight_reps', // Dead Bug
  'decline-crunch': 'bodyweight_reps', // Decline Crunch
  'decline-push-up': 'bodyweight_reps', // Decline Push-Up
  'deficit-push-ups': 'bodyweight_reps', // Deficit Push Ups
  'diamond-push-ups': 'bodyweight_reps', // Diamond Push Ups
  dips: 'bodyweight_reps', // Chest Dips
  'donkey-calf-raise': 'bodyweight_reps', // Donkey Calf Raise
  'downward-dog-knee-tuck': 'bodyweight_reps', // Downward Dog Knee Tuck
  'downward-dog-to-knee-drive': 'bodyweight_reps', // Downward Dog to Knee Drive
  'downward-dog-to-plank': 'bodyweight_reps', // Downward Dog to Plank
  'downward-dog-to-upward-dog': 'bodyweight_reps', // Downward Dog to Upward Dog
  'dragon-flag': 'bodyweight_reps', // Dragon Flag
  'glute-bridge': 'bodyweight_reps', // Glute Bridge
  'glute-kickback': 'bodyweight_reps', // Glute Kickback
  'handstand-push-ups': 'bodyweight_reps', // Handstand Push Ups
  'hanging-knee-raise': 'bodyweight_reps', // Hanging Knee Raise
  'hanging-leg-raise': 'bodyweight_reps', // Hanging Leg Raise
  'hanging-pike': 'bodyweight_reps', // Hanging Pike
  'heel-to-toe-walk': 'bodyweight_reps', // Heel-to-Toe Walk
  'incline-push-ups': 'bodyweight_reps', // Incline Push-Up
  'inverted-row': 'bodyweight_reps', // Inverted Row
  'jackknife-sit-up': 'bodyweight_reps', // Jackknife Sit-Up
  'knee-push-ups': 'bodyweight_reps', // Knee Push Ups
  lunge: 'bodyweight_reps', // Lunge
  'lying-leg-raise': 'bodyweight_reps', // Lying Leg Raise
  'muscle-ups': 'bodyweight_reps', // Muscle Ups
  'negative-pull-ups': 'bodyweight_reps', // Negative Pull Ups
  'neutral-grip-pull-ups': 'bodyweight_reps', // Neutral Grip Pull Ups
  'nordic-hamstring-curl': 'bodyweight_reps', // Nordic Hamstring Curl
  'pause-pull-up': 'bodyweight_reps', // Pause Pull-Up
  'pike-push-ups': 'bodyweight_reps', // Pike Push Ups
  'pilates-kneeling-side-kick': 'bodyweight_reps', // Pilates Kneeling Side Kick
  'pilates-leg-pull-back': 'bodyweight_reps', // Pilates Leg Pull Back
  'pilates-leg-pull-front': 'bodyweight_reps', // Pilates Leg Pull Front
  'pilates-roll-over': 'bodyweight_reps', // Pilates Roll Over
  'pilates-side-bend': 'bodyweight_reps', // Pilates Side Bend
  'pistol-squat': 'bodyweight_reps', // Pistol Squat
  'pseudo-planche-push-ups': 'bodyweight_reps', // Pseudo Planche Push Ups
  'pull-up': 'bodyweight_reps', // Pull-Up
  'push-up': 'bodyweight_reps', // Push-Up
  'reverse-crunches': 'bodyweight_reps', // Reverse Crunches
  'reverse-nordic-curl': 'bodyweight_reps', // Reverse Nordic Curl
  'reverse-plank-dips': 'bodyweight_reps', // Reverse Plank Dips
  'reverse-tabletop-hip-pulses': 'bodyweight_reps', // Reverse Tabletop Hip Pulses
  'ring-dips': 'bodyweight_reps', // Ring Dips
  'ring-face-pull': 'bodyweight_reps', // Ring Face Pull
  'ring-muscle-up': 'bodyweight_reps', // Ring Muscle-Up
  'ring-push-up': 'bodyweight_reps', // Ring Push-Up
  'ring-row': 'bodyweight_reps', // Ring Row
  'rings-inverted-row': 'bodyweight_reps', // Rings Inverted Row
  'rope-climb': 'bodyweight_reps', // Rope Climb
  'russian-twist': 'bodyweight_reps', // Russian Twist
  'scapular-pull-ups': 'bodyweight_reps', // Scapular Pull Ups
  'side-lunge': 'bodyweight_reps', // Side Lunge
  'side-lying-hip-abduction': 'bodyweight_reps', // Side-Lying Hip Abduction
  'side-lying-hip-adduction': 'bodyweight_reps', // Side Lying Hip Adduction
  'side-plank-leg-lift': 'bodyweight_reps', // Side Plank with Leg Lift
  'single-leg-calf-raise': 'bodyweight_reps', // Single Leg Calf Raise
  'single-leg-glute-bridge': 'bodyweight_reps', // Single Leg Glute Bridge
  'sit-ups': 'bodyweight_reps', // Sit-Ups
  'split-squat': 'bodyweight_reps', // Split Squat
  'stability-ball-hip-bridge': 'bodyweight_reps', // Stability Ball Hip Bridge
  'stability-ball-knee-tuck': 'bodyweight_reps', // Stability Ball Knee Tuck
  'stability-ball-push-up': 'bodyweight_reps', // Stability Ball Push-Up
  'stability-ball-push-up-hands-on-ball': 'bodyweight_reps', // Stability Ball Push-Up (Hands on Ball)
  'stability-ball-wall-squat': 'bodyweight_reps', // Stability Ball Wall Squat
  'step-ups': 'bodyweight_reps', // Step Ups
  'straight-bar-dips': 'bodyweight_reps', // Straight Bar Dips
  superman: 'bodyweight_reps', // Superman
  'supine-windshield-wipers': 'bodyweight_reps', // Supine Windshield Wipers
  'toes-to-bar': 'bodyweight_reps', // Toes to Bar
  'trx-bicep-curl': 'bodyweight_reps', // TRX Bicep Curl
  'trx-chest-press': 'bodyweight_reps', // TRX Chest Press
  'trx-face-pull': 'bodyweight_reps', // TRX Face Pull
  'trx-hamstring-curl': 'bodyweight_reps', // TRX Hamstring Curl
  'trx-lunge': 'bodyweight_reps', // TRX Lunge
  'trx-pistol-squat': 'bodyweight_reps', // TRX Pistol Squat
  'trx-row': 'bodyweight_reps', // TRX Row
  'trx-squat': 'bodyweight_reps', // TRX Squat
  'trx-tricep-extension': 'bodyweight_reps', // TRX Triceps Extension
  'trx-y-fly': 'bodyweight_reps', // TRX Y-Fly
  'v-ups': 'bodyweight_reps', // V Ups
  'walking-lunge': 'bodyweight_reps', // Walking Lunge
  'wall-push-ups': 'bodyweight_reps', // Wall Push Ups
  'wide-grip-pull-ups': 'bodyweight_reps', // Wide Grip Pull Ups
  'wide-grip-push-ups': 'bodyweight_reps', // Wide Grip Push Ups

  // ── strength · duration (51)
  'back-lever': 'duration', // Back Lever
  'bear-crawl': 'duration', // Bear Crawl
  'bird-dog-hold': 'duration', // Bird Dog Hold
  'boat-pose': 'duration', // Boat Pose
  'bow-pose': 'duration', // Bow Pose
  'chair-pose': 'duration', // Chair Pose
  'chin-tuck-hold': 'duration', // Chin Tuck Hold
  'clamshells-hold': 'duration', // Clamshell Hold
  'crescent-lunge': 'duration', // Crescent Lunge
  'crow-pose': 'duration', // Crow Pose
  'dancer-pose': 'duration', // Dancer Pose
  'dead-bug-hold': 'duration', // Dead Bug Hold
  'dead-hang': 'duration', // Dead Hang
  'dolphin-pose': 'duration', // Dolphin Pose
  'eagle-pose': 'duration', // Eagle Pose
  'extended-side-angle': 'duration', // Extended Side Angle Pose
  'flutter-kicks': 'duration', // Flutter Kicks
  'front-lever': 'duration', // Front Lever
  'glute-bridge-hold': 'duration', // Glute Bridge Hold
  'glute-kickback-hold': 'duration', // Glute Kickback Hold
  'half-moon-pose': 'duration', // Half Moon Pose
  'high-plank': 'duration', // High Plank
  'hollow-body-hold': 'duration', // Hollow Body Hold
  'human-flag': 'duration', // Human Flag
  'isometric-neck-side': 'duration', // Isometric Neck Lateral Flexion
  'l-sit': 'duration', // L Sit
  'locust-pose': 'duration', // Locust Pose
  planche: 'duration', // Planche
  plank: 'duration', // Plank
  'reverse-plank': 'duration', // Reverse Plank
  'reverse-tabletop-hold': 'duration', // Reverse Tabletop Hold
  'revolved-chair-pose': 'duration', // Revolved Chair Pose
  'revolved-crescent-lunge': 'duration', // Revolved Crescent Lunge
  'ring-dead-hang': 'duration', // Ring Dead Hang
  'scissor-kicks': 'duration', // Scissor Kicks
  'side-lying-hip-abduction-hold': 'duration', // Side-Lying Hip Abduction Hold
  'side-lying-hip-adduction-hold': 'duration', // Side-Lying Hip Adduction Hold
  'side-plank': 'duration', // Side Plank
  'side-plank-leg-lift-hold': 'duration', // Side Plank Leg Lift Hold
  'single-leg-glute-bridge-hold': 'duration', // Single-Leg Glute Bridge Hold
  'supported-shoulderstand': 'duration', // Supported Shoulderstand
  'thoracic-bridge': 'duration', // Thoracic Bridge
  'three-legged-dog': 'duration', // Three-Legged Downward Dog
  'tree-pose': 'duration', // Tree Pose
  'trx-plank': 'duration', // TRX Plank
  'trx-side-plank': 'duration', // TRX Side Plank
  'v-sit': 'duration', // V-Sit
  'wall-sit': 'duration', // Wall Sit
  'warrior-one': 'duration', // Warrior I
  'warrior-three': 'duration', // Warrior III
  'warrior-two': 'duration', // Warrior II

  // ── strength · loaded_duration (9)
  'db-overhead-carry': 'loaded_duration', // Dumbbell Overhead Carry
  'double-db-overhead-carry': 'loaded_duration', // Double Dumbbell Overhead Carry
  'double-kettlebell-overhead-carry': 'loaded_duration', // Double Kettlebell Overhead Carry
  'dumbbell-farmers-walk': 'loaded_duration', // Dumbbell Farmer's Walk
  'kettlebell-farmers-walk': 'loaded_duration', // Kettlebell Farmer's Walk
  'kettlebell-overhead-carry': 'loaded_duration', // Kettlebell Overhead Carry
  'plate-pinch': 'loaded_duration', // Plate Pinch
  'sled-row': 'loaded_duration', // Sled Row
  'suitcase-carry': 'loaded_duration', // Suitcase Carry
};

/** The reviewed profile for a RepDB exercise id, or `undefined` if it was never reviewed. */
export function getMetricProfile(
  exerciseId: string,
): (MetricProfile & { name: MetricProfileName }) | undefined {
  const name = EXERCISE_METRIC_PROFILES[exerciseId];
  return name ? { name, ...METRIC_PROFILES[name] } : undefined;
}
