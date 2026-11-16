"use client";

/**
 * Whether the person looking at the dashboard may change it.
 *
 * Decided on the server per request (`createPolishdPage({ readOnly })`) and
 * handed down here, so controls that write — save a setting, file an issue,
 * capture a snapshot, spend the model key — can step aside instead of being
 * pressed and refused. The server actions check again on every call; this is
 * only so the page doesn't offer what it can't do.
 */
import { createContext, useContext, useTransition, type ReactNode } from "react";

const ReadOnlyContext = createContext(false);

export function PolishdAccessProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactNode;
}) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}

/** True when this viewer can look but not change anything. */
export function usePolishdReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

/** The tooltip a control carries when read-only mode turns it off. */
export const READ_ONLY_TITLE = "This dashboard is read-only";

/**
 * Shown when a call fails with nothing more specific to say: the action was
 * refused, the session expired, or the server didn't answer.
 */
export const UNREACHABLE_MESSAGE = "Couldn't reach the server — reload the page and try again.";

/**
 * `useTransition`, except a thrown error lands in `onError` as a message
 * instead of escaping the transition. A server action that is refused (read-
 * only, an expired session) or never answers rejects rather than returning a
 * result, and a rejection inside a transition reaches the error boundary and
 * takes the whole tab down.
 */
export function useSafeTransition(
  onError: (message: string) => void,
): [boolean, (body: () => Promise<void>) => void] {
  const [pending, startTransition] = useTransition();
  const start = (body: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await body();
      } catch {
        onError(UNREACHABLE_MESSAGE);
      }
    });
  return [pending, start];
}
