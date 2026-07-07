/**
 * Test helper: mount a leaf that consumes app-shell context (useNavIntents via
 * useNavigate/useParams, useChat) inside a memory router and the ChatProvider, at
 * a project-scoped path so `useParams().projectId` resolves. Returns the
 * RenderResult so callers keep screen/unmount access.
 */
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ChatProvider } from "./chatContext";

export function renderInShell(
  element: ReactElement,
  initialPath = "/project/p1",
): RenderResult {
  const router = createMemoryRouter(
    [
      {
        path: "/project/:projectId",
        element: <ChatProvider>{element}</ChatProvider>,
      },
    ],
    { initialEntries: [initialPath] },
  );
  return render(<RouterProvider router={router} />);
}
