import { ValidationError } from "./validation";

/**
 * Shape every form action returns, for `useActionState`. One optional error
 * and one optional confirmation — enough for the handful of forms here, and it
 * keeps error text next to the form that caused it.
 */
export type FormState = { error?: string; ok?: string } | undefined;

/**
 * Run an action body, turning a ValidationError into a message the member can
 * read. Anything else is a real fault and is left to bubble up to the error
 * boundary rather than being flattened into "something went wrong".
 */
export async function withFormErrors(
  body: () => Promise<FormState>,
): Promise<FormState> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
}
