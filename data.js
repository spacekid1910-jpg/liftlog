// Exercise catalogue and day templates. Ranges are rep targets used for progression suggestions.
// `m` is the main muscle group, used for the weekly balance check.
window.FIT = {
  CATALOG: [
    // Pull
    { id: 'lat-pulldown', name: 'Lat Pulldown', m: 'Back', sets: 4, lo: 6, hi: 10, step: 2.5 },
    { id: 'seated-row', name: 'Seated Row', m: 'Back', sets: 3, lo: 6, hi: 10, step: 2.5 },
    { id: 'cable-curl', name: 'Cable Biceps Curl', m: 'Biceps', sets: 3, lo: 10, hi: 15, step: 2.5 },
    { id: 'rear-delt-fly', name: 'Rear Delt Fly (Pec Deck)', m: 'Rear delts', sets: 3, lo: 10, hi: 15, step: 2.5 },
    { id: 'preacher-curl', name: 'Preacher Curl', m: 'Biceps', sets: 3, lo: 10, hi: 15, step: 2.5 },
    { id: 'pull-up', name: 'Pull-ups', m: 'Back', sets: 3, lo: 6, hi: 10, step: 2.5, bw: true },
    { id: 'face-pull', name: 'Face Pull', m: 'Rear delts', sets: 3, lo: 12, hi: 20, step: 2.5 },
    { id: 'hammer-curl', name: 'Hammer Curl', m: 'Biceps', sets: 3, lo: 10, hi: 15, step: 2 },
    { id: 'chest-supported-row', name: 'Chest-Supported Row', m: 'Back', sets: 3, lo: 6, hi: 10, step: 2.5 },
    // Push
    { id: 'bench-press', name: 'Bench Press', m: 'Chest', sets: 4, lo: 6, hi: 10, step: 2.5 },
    { id: 'cable-fly', name: 'Cable Fly (Machine)', m: 'Chest', sets: 3, lo: 10, hi: 15, step: 2.5 },
    { id: 'db-shoulder-press', name: 'Dumbbell Shoulder Press', m: 'Shoulders', sets: 3, lo: 6, hi: 10, step: 2 },
    { id: 'tricep-pushdown', name: 'Tricep Pushdown', m: 'Triceps', sets: 3, lo: 10, hi: 15, step: 2.5 },
    { id: 'lateral-raise', name: 'Lateral Raise', m: 'Shoulders', sets: 3, lo: 12, hi: 20, step: 1 },
    { id: 'overhead-tricep-ext', name: 'Overhead Cable Extension', m: 'Triceps', sets: 3, lo: 10, hi: 15, step: 2.5 },
    { id: 'incline-db-press', name: 'Incline Dumbbell Press', m: 'Chest', sets: 3, lo: 6, hi: 10, step: 2 },
    // Legs
    { id: 'leg-press', name: 'Leg Press', m: 'Quads', sets: 3, lo: 8, hi: 12, step: 5 },
    { id: 'rdl', name: 'Romanian Deadlift', m: 'Hamstrings', sets: 3, lo: 6, hi: 10, step: 5 },
    { id: 'leg-curl', name: 'Leg Curl', m: 'Hamstrings', sets: 3, lo: 10, hi: 15, step: 2.5 },
    { id: 'calf-raise', name: 'Calf Raise', m: 'Calves', sets: 3, lo: 10, hi: 15, step: 5 },
    { id: 'squat', name: 'Squat', m: 'Quads', sets: 3, lo: 6, hi: 10, step: 2.5 },
    { id: 'leg-extension', name: 'Leg Extension', m: 'Quads', sets: 3, lo: 10, hi: 15, step: 2.5 },
  ],
  TEMPLATES: {
    pull: {
      label: 'Pull',
      core: ['lat-pulldown', 'seated-row', 'cable-curl', 'rear-delt-fly', 'preacher-curl'],
      extra: ['pull-up', 'face-pull', 'hammer-curl', 'chest-supported-row'],
    },
    push: {
      label: 'Push',
      core: ['bench-press', 'cable-fly', 'db-shoulder-press', 'tricep-pushdown'],
      extra: ['lateral-raise', 'overhead-tricep-ext', 'incline-db-press'],
    },
    legs: {
      label: 'Legs',
      core: ['leg-press', 'rdl', 'leg-curl', 'calf-raise'],
      extra: ['squat', 'leg-extension'],
    },
  },
  // Minimum sets per week per muscle before the balance check flags it (about 10 is a common target).
  MIN_SETS: { Chest: 6, Back: 6, Shoulders: 6, 'Rear delts': 3, Biceps: 5, Triceps: 5, Quads: 6, Hamstrings: 4, Calves: 3 },
  // getDay(): 0 = Sunday ... 6 = Saturday
  SCHEDULE: { 2: 'pull', 5: 'push' },
};
