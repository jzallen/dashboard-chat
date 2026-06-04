// Vite entry for the dashboard-chat-layers app.
//
// CSS is imported in the same order the prototype's HTML linked it (theme.css
// first so later sheets can override), then the app module — whose top-level
// createRoot(...).render(<App/>) mounts into <div id="root"> from index.html.
import "./app/theme.css";
import "./app/detail.css";
import "./app/chat.css";
import "./app/theme.neobrutalist.css";

import "./app/app.tsx";
