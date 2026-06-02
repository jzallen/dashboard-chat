// Vite entry for the dashboard-chat-layers prototype harness.
//
// CSS is imported in the same order the prototype's HTML linked it (theme.css
// first so later sheets can override). The prototype itself is the virtual
// module assembled in vite.config.js (see prototype-bundle plugin); importing
// it executes app.jsx's `ReactDOM.createRoot(...).render(<App/>)` and mounts
// into <div id="root"> from index.html.
import "./app/theme.css";
import "./app/lineage.css";
import "./app/detail.css";
import "./app/chat.css";
import "./app/upload.css";
import "./app/themes.css";

import "virtual:prototype";
