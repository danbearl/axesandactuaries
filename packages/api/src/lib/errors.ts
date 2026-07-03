// Signals a lost race in an atomic claim (an updateMany that matched zero
// rows, or a serializable transaction whose re-check failed) — distinct from
// an unexpected failure. Route handlers catch this and return 409/403.
export class ClaimConflictError extends Error {}
