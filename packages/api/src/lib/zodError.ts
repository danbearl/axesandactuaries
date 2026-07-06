import type { ZodError } from 'zod';

// Flattens a ZodError into a single human-readable string. `error.flatten()` groups
// messages under `formErrors`/`fieldErrors`, which is a structured object, not a string —
// every other error response in this codebase is `{ error: string }`, so passing that
// object straight through (as several routes previously did) breaks any frontend code that
// renders `err.message` directly, producing a literal "[object Object]" in the UI.
export function zodErrorMessage(error: ZodError): string {
  const flat = error.flatten();
  const messages = [...flat.formErrors, ...Object.values(flat.fieldErrors).flat()];
  return messages.join('; ') || 'Invalid request';
}
