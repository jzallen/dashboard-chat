/**
 * Click-to-edit mechanics shared by the header's two inline editors (the display
 * name and the dbt machine name).
 *
 * Both editors follow the same pessimistic shape: a click swaps the static label
 * for a seeded draft input; Enter or blur commits; Escape reverts. An empty
 * (whitespace-only) or unchanged draft is a no-op — it neither commits nor errors.
 * What differs is the *effect* of a valid commit, so that is the caller's:
 * `onCommit` fires with the trimmed value only when it is non-empty and changed.
 * The display-name editor submits straight to its action; the machine-name editor
 * stages the value behind a confirm dialog. Neither difference lives here.
 */
import { useState } from "react";

export interface InlineEdit {
  /** True while the draft input is shown in place of the static label. */
  editing: boolean;
  /** The current draft text. */
  draft: string;
  /** Enter editing, seeding the draft from the current text. */
  begin: () => void;
  /** Update the draft (the input's onChange). */
  setDraft: (value: string) => void;
  /** Leave editing and revert the draft to the current text (Escape). */
  cancel: () => void;
  /** Leave editing and fire `onCommit` iff the draft is non-empty and changed. */
  commit: () => void;
}

/**
 * Drive a single click-to-edit field. `text` is the committed value the draft is
 * seeded from and compared against; `onCommit` receives the trimmed draft only
 * when it is a genuine change.
 */
export function useInlineEdit(
  text: string,
  onCommit: (next: string) => void,
): InlineEdit {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const begin = () => {
    setDraft(text);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(text);
    setEditing(false);
  };

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === text) return; // no-op / cancel
    onCommit(next);
  };

  return { editing, draft, begin, setDraft, cancel, commit };
}
