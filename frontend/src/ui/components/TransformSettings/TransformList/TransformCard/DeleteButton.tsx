/**
 * Delete button for inactive transforms
 */

import { TrashIcon } from "@heroicons/react/24/outline";

import styles from "./TransformCard.module.css";

interface DeleteButtonProps {
  onClick: () => void;
}

export function DeleteButton({ onClick }: DeleteButtonProps) {
  return (
    <button
      onClick={onClick}
      className={styles.deleteButton}
      title="Delete transform permanently"
    >
      <TrashIcon className={styles.deleteIcon} />
    </button>
  );
}
