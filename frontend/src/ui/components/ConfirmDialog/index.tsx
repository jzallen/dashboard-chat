// ConfirmDialog — generic confirm/cancel dialog (MR-7). RED scaffold (created by DISTILL).
//
// Reuses the ActivityCheckModal overlay / Esc / focus pattern. Used by the snowflake
// "move to cold storage" action (and reusable for other destructive confirmations).
// Returns null while closed so hosts that always mount it stay green until opened.
// DELIVER 07-03 replaces the open body.
export const __SCAFFOLD__ = true;

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null {
  if (!props.open) return null;
  throw new Error("Not yet implemented — RED scaffold (ConfirmDialog, MR-7)");
}

export default ConfirmDialog;
