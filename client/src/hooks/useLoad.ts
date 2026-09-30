import { useEffect, useState } from "react";
import { getErrorMessage } from "../lib/errors";

/**
 * Loads data whenever `key` changes (put every input of `load` in the key).
 * While a new key loads, the previous data stays on screen. `reload()`
 * fetches the same key again, e.g. after an action changed the data.
 */
export function useLoad<T>(key: string, load: () => Promise<T>, fallbackError = "Couldn't load this page.") {
  const [reloads, setReloads] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  const fullKey = `${key}#${reloads}`;

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ key: fullKey, data, error: "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((previous) => ({ key: fullKey, data: previous.data, error: getErrorMessage(error, fallbackError) }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names everything `load` depends on
  }, [fullKey]);

  return {
    data: state.data,
    error: state.key === fullKey ? state.error : "",
    loading: state.key !== fullKey,
    reload: () => setReloads((count) => count + 1),
  };
}
