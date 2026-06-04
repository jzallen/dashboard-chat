/* Tweak-value store: the single source of truth for tweak values. setTweak
   persists via the host (__edit_mode_set_keys → host rewrites the EDITMODE
   block on disk). */
import { useCallback, useState } from "react";

type TweakValues = Record<string, unknown>;
type SetTweak = (keyOrEdits: string | TweakValues, val?: unknown) => void;

export function useTweaks(defaults: TweakValues): [TweakValues, SetTweak] {
  const [values, setValues] = useState<TweakValues>(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = useCallback<SetTweak>((keyOrEdits, val) => {
    const edits =
      typeof keyOrEdits === "object" && keyOrEdits !== null
        ? keyOrEdits
        : { [keyOrEdits]: val };
    setValues((prev) => ({ ...prev, ...edits }));
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits }, "*");
    // Same-window signal so in-page listeners (deck-stage rail thumbnails) can
    // react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent("tweakchange", { detail: edits }));
  }, []);
  return [values, setTweak];
}
