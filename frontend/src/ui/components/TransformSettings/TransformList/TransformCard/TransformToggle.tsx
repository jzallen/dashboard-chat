/**
 * Toggle switch for activating/deactivating a transform
 */

import styles from "./TransformCard.module.css";

interface TransformToggleProps {
  isActive: boolean;
  onToggle: () => void;
}

export function TransformToggle({ isActive, onToggle }: TransformToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`${styles.toggleSwitch} ${
        isActive
          ? styles.toggleSwitchActive
          : styles.toggleSwitchInactive
      }`}
      title={isActive ? "Deactivate this transform" : "Activate this transform"}
    >
      <span
        className={`${styles.toggleKnob} ${
          isActive ? styles.toggleKnobActive : styles.toggleKnobInactive
        }`}
      />
    </button>
  );
}
