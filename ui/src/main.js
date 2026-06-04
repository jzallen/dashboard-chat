// Vite entry for the dashboard-chat-layers app.
//
// CSS is imported in the same order the prototype's HTML linked it (theme.css
// first so later sheets can override), then the dev-login gate decides what to
// mount. The logged-in path calls app.mount(), which renders the exact same
// provider/AppShell tree as before — the gate is purely additive in front of it.
import { handleCallback, extractCode, login } from "../src/auth/bootstrap.ts";
import { getToken } from "../src/auth/tokenStorage.ts";

import { mount } from "./app/app.tsx";
import "./app/theme.css";
import "./app/theme.neobrutalist.css";

// Minimal one-button sign-in screen for AUTH_MODE=dev. No framework — a single
// button whose click kicks off the GET /api/auth/login redirect.
function renderSignIn() {
  const rootEl = document.getElementById("root");
  if (!rootEl) return;
  rootEl.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.style.cssText =
    "min-height:100vh;display:flex;align-items:center;justify-content:center;";

  const button = document.createElement("button");
  button.textContent = "Sign in (dev)";
  button.style.cssText =
    "font:600 18px/1 system-ui,sans-serif;padding:14px 28px;cursor:pointer;" +
    "border:3px solid #000;border-radius:10px;background:#ffe14d;" +
    "box-shadow:4px 4px 0 #000;";
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Redirecting…";
    login().catch((err) => {
      button.disabled = false;
      button.textContent = "Sign in (dev)";
      console.error("login failed", err);
    });
  });

  wrap.appendChild(button);
  rootEl.appendChild(wrap);
}

async function bootstrap() {
  // (a) Returning from the auth-proxy redirect: exchange the code, store the
  //     token, scrub it from the URL, then mount the app.
  if (window.location.pathname === "/auth/callback") {
    const code = extractCode(window.location.search);
    if (code) {
      try {
        await handleCallback(code);
        window.history.replaceState({}, "", "/");
        mount();
        return;
      } catch (err) {
        console.error("auth callback failed", err);
        renderSignIn();
        return;
      }
    }
  }

  // (b) No token yet: show the dev sign-in screen.
  if (!getToken()) {
    renderSignIn();
    return;
  }

  // (c) Already authenticated: mount the app exactly as before.
  mount();
}

bootstrap();
