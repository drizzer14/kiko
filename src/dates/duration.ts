// The single source of truth for the day-in-milliseconds constant that the
// line chart's day-bucketing and the screens' range math reuse. Kept here in
// `src/dates/` beside the other date utilities so no module redefines its own
// near-duplicate copy.
export const DAY_MS = 86_400_000;
