import type { ReactNode } from "react";
import styles from "./Pagination.module.css";

interface PageButtonProps {
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}

export function PageButton({ onClick, disabled, children }: PageButtonProps) {
  return (
    <button
      className={styles.pageButton}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
