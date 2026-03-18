import styles from "./chat.module.css";

interface WelcomeStateProps {
  onUploadCsv: () => void;
  onBrowseProjects: () => void;
}

export function WelcomeState({ onUploadCsv, onBrowseProjects }: WelcomeStateProps) {
  return (
    <div className={styles.welcomeContainer}>
      <h2 className={styles.welcomeTitle}>Welcome to Dashboard Chat</h2>
      <p className={styles.welcomeSubtitle}>
        Start a conversation to explore and control your data tables using natural language.
      </p>
      <div className={styles.suggestionChips}>
        <button
          type="button"
          className={styles.chip}
          onClick={onUploadCsv}
        >
          Upload a CSV
        </button>
        <button
          type="button"
          className={styles.chip}
          onClick={onBrowseProjects}
        >
          Browse Projects
        </button>
      </div>
    </div>
  );
}
