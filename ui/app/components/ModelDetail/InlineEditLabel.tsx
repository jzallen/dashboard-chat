/**
 * Presentational click-to-edit label. Renders the static text as a clickable
 * element until editing, then swaps to a seeded, auto-focused draft input wired
 * to Enter/blur commit and Escape cancel. All state lives in the {@link InlineEdit}
 * the caller passes in — this component holds none.
 *
 * The static and editing class names are supplied by the caller so each editor
 * keeps its own styling and aria-label (the tests select on both). When `edit`
 * is absent (a non-editable node) the text renders as a plain, unclickable label.
 */
import type { InlineEdit } from "./useInlineEdit";

export function InlineEditLabel({
  text,
  edit,
  className,
  editingClassName,
  ariaLabel,
}: {
  text: string;
  edit?: InlineEdit;
  className: string;
  editingClassName: string;
  ariaLabel: string;
}) {
  if (!edit) {
    return <div className={className}>{text}</div>;
  }

  if (!edit.editing) {
    return (
      <div className={className} onClick={edit.begin}>
        {text}
      </div>
    );
  }

  return (
    <input
      className={`${className} ${editingClassName}`}
      aria-label={ariaLabel}
      autoFocus
      value={edit.draft}
      onChange={(e) => edit.setDraft(e.target.value)}
      onBlur={edit.commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") edit.commit();
        if (e.key === "Escape") edit.cancel();
      }}
    />
  );
}
