/* Theme context. The app has a single visual theme (Neobrutalist); the only
   thing the user controls is light vs dark, which is persisted to localStorage.
   (A fuller set of design knobs — accent, palette, fonts, surface — lives
   unmounted as the parked example in Tweaks.) */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const DARK_KEY = "dashboard-chat:dark";

type ThemeApi = {
  dark: boolean;
  setDark: (dark: boolean) => void;
  toggleDark: () => void;
  /** The root element's theme class (theme + dark). The shell appends any
      route-driven modifiers (e.g. org-open) on top of this. */
  rootClassName: string;
};

const ThemeContext = createContext<ThemeApi | null>(null);

function readDark(): boolean {
  try {
    return localStorage.getItem(DARK_KEY) === "1";
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(readDark);
  useEffect(() => {
    try {
      localStorage.setItem(DARK_KEY, dark ? "1" : "0");
    } catch {
      /* storage unavailable — dark just won't persist */
    }
  }, [dark]);
  const value = useMemo<ThemeApi>(
    () => ({
      dark,
      setDark,
      toggleDark: () => setDark((d) => !d),
      rootClassName: "app theme-neobrutalist" + (dark ? " dark" : ""),
    }),
    [dark],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
