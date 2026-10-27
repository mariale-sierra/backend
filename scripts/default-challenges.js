'use strict';

/**
 * Sprint 10 — the default challenges the app ships with (created by the official
 * @havit account with scripts/seed-default-challenges.js).
 *
 * Every exercise name must exist, active, in the exercise catalog (RepDB only
 * since 2026-09-03-11; the old hand-seeded exercises are inactive): the script
 * looks each one up and stops if one is missing, so a typo never creates a stray
 * catalog entry.
 *
 * The card's color comes from the exercises' own catalog category (the most
 * common one; a tie goes to the challenge's own category). RepDB has a single
 * Cardio Low exercise, "Walking", so the Cardio Low challenges lean on it.
 *
 * Exercise targets:
 *  - sets/reps exercises: `sets`, `reps`, `rest` (seconds between sets);
 *  - timed/distance exercises: `time` ('mm:ss') and optionally `distance` (km).
 *    The script only sends the metrics each exercise actually tracks.
 *
 * `cover` is the file name (without extension) of the cover photo in the covers
 * folder: <cover>.jpg / .jpeg / .png / .webp.
 */

const rest = { rest: true };

module.exports = [
  {
    cover: 'strength-foundations',
    name: 'Strength Foundations',
    activity: 'strength',
    categories: ['Strength'],
    locations: ['Gym'],
    durationDays: 28,
    description:
      'Four weeks of the big lifts — squat, bench, deadlift and press — on a simple lower / upper / full-body split. Built for steady progress: add a little weight when every set feels solid.',
    days: [
      {
        name: 'Lower Body',
        description: 'Squat and hinge, then volume for the legs.',
        exercises: [
          { name: 'Front Squat', sets: 4, reps: 8, rest: 120 },
          { name: 'Romanian Deadlift', sets: 3, reps: 10, rest: 90 },
          { name: 'Horizontal Leg Press', sets: 3, reps: 12, rest: 90 },
          { name: 'Dumbbell Calf Raise', sets: 3, reps: 15, rest: 60 },
        ],
      },
      {
        name: 'Upper Body',
        description: 'Push and pull, balanced.',
        exercises: [
          { name: 'Incline Barbell Bench Press', sets: 4, reps: 8, rest: 120 },
          { name: 'Pendlay Row', sets: 4, reps: 8, rest: 90 },
          { name: 'Barbell Overhead Press', sets: 3, reps: 10, rest: 90 },
          { name: 'Close Grip Lat Pulldown', sets: 3, reps: 12, rest: 60 },
        ],
      },
      rest,
      {
        name: 'Full Body',
        description: 'Heavy deadlifts, then the rest of the body.',
        exercises: [
          { name: 'Hex Bar Deadlift', sets: 3, reps: 5, rest: 150 },
          { name: 'Dumbbell Bench Press', sets: 3, reps: 10, rest: 90 },
          { name: 'Pull-Up', sets: 3, reps: 8, rest: 90 },
          { name: 'Goblet Squat', sets: 3, reps: 12, rest: 60 },
        ],
      },
    ],
  },
  {
    cover: 'dumbbell-home-strength',
    name: 'Dumbbell Home Strength',
    activity: 'strength',
    categories: ['Strength'],
    locations: ['Home'],
    durationDays: 21,
    description:
      'Three weeks of full-body strength with just a pair of dumbbells. Two training days and a rest day, on repeat — no gym needed.',
    days: [
      {
        name: 'Push & Legs',
        description: 'Squats, presses and lunges.',
        exercises: [
          { name: 'Dumbbell Squat', sets: 4, reps: 12, rest: 75 },
          { name: 'Dumbbell Floor Press', sets: 4, reps: 10, rest: 75 },
          { name: 'Dumbbell Shoulder Press', sets: 3, reps: 10, rest: 60 },
          { name: 'Dumbbell Lunge', sets: 3, reps: 10, rest: 60 },
        ],
      },
      {
        name: 'Pull & Hinge',
        description: 'Back, hamstrings and glutes.',
        exercises: [
          { name: 'Dumbbell Romanian Deadlift', sets: 4, reps: 10, rest: 75 },
          { name: 'Bent-Over Dumbbell Row', sets: 4, reps: 10, rest: 60 },
          { name: 'Dumbbell Hip Thrust', sets: 3, reps: 12, rest: 60 },
          { name: 'Dumbbell Hammer Curl', sets: 3, reps: 12, rest: 45 },
        ],
      },
      rest,
    ],
  },
  {
    cover: 'hiit-ignite',
    name: 'HIIT Ignite',
    activity: 'cardioIntense',
    categories: ['Cardio Intense'],
    locations: ['Gym'],
    durationDays: 14,
    description:
      'Two weeks of hard, short cardio on the gym machines. Push the pace on every block — then rest, because the rest day is part of the plan.',
    days: [
      {
        name: 'Engine Builder',
        description: 'Bike, rower and rope, back to back.',
        exercises: [
          { name: 'Air Bike', time: '10:00' },
          { name: 'Rowing Machine', time: '12:00', distance: 2.5 },
          { name: 'Jump Rope', time: '08:00' },
        ],
      },
      {
        name: 'Sweat Session',
        description: 'Run, ropes and stairs.',
        exercises: [
          { name: 'Treadmill Running', time: '15:00', distance: 2.5 },
          { name: 'Battle Rope Double Slam', sets: 4, reps: 15, rest: 45 },
          { name: 'Stair Climber', time: '10:00' },
        ],
      },
      rest,
    ],
  },
  {
    cover: 'couch-to-5k',
    name: 'Couch to 5K',
    activity: 'cardioIntense',
    categories: ['Cardio Intense'],
    // The catalog's only active running exercise is the treadmill one (RepDB's
    // "Running" was never imported), so the plan is logged as Treadmill Running.
    locations: ['Gym'],
    durationDays: 30,
    description:
      'A month of running that ends with a full 5K. An easy run, a longer run, and a rest day — repeat until 5 km feels like yours. Logged on the treadmill; run outside whenever you can.',
    days: [
      {
        name: 'Easy Run',
        description: 'Conversational pace. Walk breaks are fine.',
        exercises: [{ name: 'Treadmill Running', time: '20:00', distance: 3 }],
      },
      {
        name: 'Long Run',
        description: 'Steady, a little further every week.',
        exercises: [{ name: 'Treadmill Running', time: '32:00', distance: 5 }],
      },
      rest,
    ],
  },
  {
    cover: 'daily-walk-habit',
    name: 'Daily Walk Habit',
    activity: 'cardioLow',
    categories: ['Cardio Low'],
    locations: ['Outdoor'],
    durationDays: 21,
    description:
      'Three weeks to make walking a daily habit. Six walking days and one easy day a week — headphones optional, consistency required.',
    days: [
      {
        name: 'Steady Walk',
        description: 'A comfortable, steady pace.',
        exercises: [{ name: 'Walking', time: '30:00', distance: 2.5 }],
      },
      {
        name: 'Brisk Walk',
        description: 'Walk like you are late for something.',
        exercises: [{ name: 'Walking', time: '30:00', distance: 3 }],
      },
      {
        name: 'Steady Walk',
        description: 'A comfortable, steady pace.',
        exercises: [{ name: 'Walking', time: '35:00', distance: 3 }],
      },
      {
        name: 'Recovery Walk',
        description: 'Slow and easy — let the legs recover.',
        exercises: [{ name: 'Walking', time: '20:00', distance: 1.5 }],
      },
      {
        name: 'Brisk Walk',
        description: 'Walk like you are late for something.',
        exercises: [{ name: 'Walking', time: '35:00', distance: 3.5 }],
      },
      {
        name: 'Long Walk',
        description: 'The longest walk of the week.',
        exercises: [{ name: 'Walking', time: '45:00', distance: 4 }],
      },
      rest,
    ],
  },
  {
    cover: 'zone-2-base',
    name: 'Zone 2 Base',
    activity: 'cardioLow',
    categories: ['Cardio Low'],
    locations: ['Gym', 'Outdoor'],
    durationDays: 21,
    description:
      'Low-intensity cardio that builds your aerobic base: you should be able to talk the whole time. Keep every session easy — the machines here are for a slow, steady pace, not for speed.',
    // Each day pairs one machine (Cardio Intense in the catalog) with a walk
    // (Cardio Low): the tie goes to the challenge's own category, Cardio Low.
    days: [
      {
        name: 'Zone 2 Ride',
        description: 'Easy, steady pedaling, then an easy walk.',
        exercises: [
          { name: 'Stationary Bike', time: '35:00' },
          { name: 'Walking', time: '10:00', distance: 0.8 },
        ],
      },
      {
        name: 'Incline Walk',
        description: 'A gentle incline, conversational pace.',
        exercises: [
          { name: 'Incline Treadmill Walk', time: '30:00' },
          { name: 'Walking', time: '10:00', distance: 0.8 },
        ],
      },
      rest,
    ],
  },
  {
    cover: 'daily-mobility',
    name: 'Daily Mobility',
    activity: 'flexibility',
    categories: ['Flexibility'],
    locations: ['Anywhere'],
    durationDays: 14,
    description:
      'Ten minutes of stretching a day for two weeks. Alternate lower body and upper body; breathe slowly and never force a stretch.',
    days: [
      {
        name: 'Hips & Legs',
        description: 'Quads, hip flexors, glutes and calves.',
        exercises: [
          { name: 'Standing Quad Stretch', time: '01:00' },
          { name: 'Kneeling Hip Flexor Stretch', time: '01:00' },
          { name: 'Pigeon Stretch', time: '01:30' },
          { name: 'Butterfly Stretch', time: '01:00' },
          { name: 'Standing Calf Stretch', time: '01:00' },
        ],
      },
      {
        name: 'Shoulders & Spine',
        description: 'Chest, shoulders, arms, neck and back.',
        exercises: [
          { name: 'Cross-Body Shoulder Stretch', time: '01:00' },
          { name: 'Doorway Chest Stretch', time: '01:00' },
          { name: 'Overhead Triceps Stretch', time: '01:00' },
          { name: 'Cat Stretch', time: '01:00' },
          { name: 'Neck Side Stretch', time: '01:00' },
          { name: 'Standing Side Bend', time: '01:00' },
        ],
      },
    ],
  },
  {
    cover: 'yoga-flow-basics',
    name: 'Yoga Flow Basics',
    activity: 'mindBody',
    categories: ['Mind-Body'],
    locations: ['Anywhere'],
    durationDays: 21,
    description:
      'Three weeks of beginner-friendly yoga: a short morning flow and a slower practice to open up, with a rest day in between.',
    days: [
      {
        name: 'Morning Flow',
        description: 'Wake the body up, one breath per movement.',
        exercises: [
          { name: 'Mountain Pose', time: '01:00' },
          { name: 'Downward-Facing Dog', time: '01:00' },
          { name: 'Low Lunge', time: '01:00' },
          { name: 'Cobra Stretch', time: '01:00' },
          { name: "Child's Pose", time: '02:00' },
        ],
      },
      {
        name: 'Open & Unwind',
        description: 'Slower holds and a long rest at the end.',
        exercises: [
          { name: 'Triangle Pose', time: '01:00' },
          { name: 'Pyramid Pose', time: '01:00' },
          { name: 'Garland Pose', time: '01:00' },
          { name: 'Seated Forward Fold', time: '02:00' },
          { name: 'Supine Spinal Twist', time: '01:00' },
          { name: 'Corpse Pose', time: '05:00' },
        ],
      },
      rest,
    ],
  },
  {
    cover: 'calm-mind',
    name: 'Calm Mind',
    activity: 'mindBody',
    categories: ['Mind-Body'],
    locations: ['Anywhere'],
    durationDays: 14,
    description:
      'Twenty minutes a day to slow down: seated breathing, a few gentle restorative poses and a long rest. Two weeks to notice the difference.',
    days: [
      {
        name: 'Daily Reset',
        description: 'Sit in Easy Pose and breathe slowly, then unwind.',
        exercises: [
          { name: 'Easy Pose', time: '08:00' },
          { name: "Child's Pose", time: '02:00' },
          { name: 'Supine Spinal Twist', time: '02:00' },
          { name: 'Legs-Up-the-Wall Pose', time: '03:00' },
          { name: 'Corpse Pose', time: '05:00' },
        ],
      },
    ],
  },
  {
    cover: 'bodyweight-athlete',
    name: 'Bodyweight Athlete',
    activity: 'functional',
    categories: ['Functional'],
    locations: ['Anywhere'],
    durationDays: 28,
    description:
      'Four weeks of athletic bodyweight training: power, core control and conditioning. No equipment — just you and some floor space.',
    days: [
      {
        name: 'Power',
        description: 'Explosive moves, full effort.',
        exercises: [
          { name: 'Burpees', sets: 4, reps: 10, rest: 60 },
          { name: 'Jump Squat', sets: 4, reps: 12, rest: 60 },
          { name: 'Push-Up', sets: 4, reps: 12, rest: 60 },
          { name: 'Mountain Climbers', time: '01:00' },
        ],
      },
      {
        name: 'Core & Control',
        description: 'Slow, controlled core work.',
        exercises: [
          { name: 'Dead Bug', sets: 3, reps: 12, rest: 45 },
          { name: 'Bird-Dog', sets: 3, reps: 10, rest: 45 },
          { name: 'Sit-Ups', sets: 3, reps: 15, rest: 45 },
          { name: 'Side Plank', time: '00:45' },
          { name: 'Plank', time: '01:00' },
        ],
      },
      rest,
      {
        name: 'Conditioning',
        description: 'Keep moving, short breaks.',
        exercises: [
          { name: 'Jumping Jacks', time: '02:00' },
          { name: 'Bear Crawl', time: '01:00' },
          { name: 'Plyo Lunge', sets: 3, reps: 10, rest: 45 },
          { name: 'Decline Push-Up', sets: 3, reps: 10, rest: 60 },
          { name: 'Wall Sit', time: '01:00' },
        ],
      },
    ],
  },
];
