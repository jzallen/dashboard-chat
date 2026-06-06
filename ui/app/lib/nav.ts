/* Navigation intents — the URL-emitting layer that replaces useNavigation.ts.
   nodeToPath maps a lineage node to its resource URL (the kind lives on
   node.ref.kind); useNavIntents wraps useNavigate/useLocation so leaf views
   keep calling openNode / selectProject / toggleOrg / openRecent / go, now
   resolved against the URL instead of the old two-atom state. Chat-open intents
   reach the useChat() context, never navigation. */
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

import { catalog } from "../../src/app/useCatalog";
import type { LineageNode, ProjectSummary } from "../../src/lib/catalog";
import { useChat } from "./chatContext";

/** The node kind discriminant, read off the loose ModelRef bag. */
function kindOf(node: LineageNode): string | undefined {
  return node.ref?.kind as string | undefined;
}

/** The resource path prefix for a node's kind. */
const KIND_PREFIX: Record<string, string> = {
  dataset: "/table",
  view: "/view",
  report: "/report",
};

/**
 * The deep-linkable URL for a lineage node: `/table|/view|/report` + `/:id`,
 * with `?project=<id>` appended when a project is supplied. Mirrors the split
 * resource routes in frontend/app/routes.ts so a later merge is mechanical.
 */
export function nodeToPath(node: LineageNode, project?: string): string {
  const prefix = KIND_PREFIX[kindOf(node) ?? ""] ?? "/table";
  const base = `${prefix}/${node.id}`;
  return project ? `${base}?project=${project}` : base;
}

/** A nav request handed back from leaf views (Chat / ChatSessionList). */
export type NavIntent = { name: string; nodeId?: string | null };

/**
 * The intent surface leaf views and the shell call. Navigation intents resolve
 * to URL changes (useNavigate); chat-open intents reach the useChat() setter.
 */
export function useNavIntents() {
  const navigate = useNavigate();
  const location = useLocation();
  const { openChat } = useChat();

  const currentProject = new URLSearchParams(location.search).get("project");

  const openNode = useCallback(
    (node: LineageNode) => {
      navigate(nodeToPath(node, currentProject ?? undefined));
    },
    [navigate, currentProject],
  );

  const selectProject = useCallback(
    (project: ProjectSummary) => {
      navigate(
        { pathname: "/", search: `?project=${project.id}` },
        { replace: true },
      );
    },
    [navigate],
  );

  const toggleOrg = useCallback(() => {
    if (location.pathname === "/org") {
      // A direct /org deep-link has no prior entry; fall to the workspace.
      if (location.key === "default") {
        navigate("/");
        return;
      }
      navigate(-1);
      return;
    }
    navigate("/org");
  }, [navigate, location.pathname, location.key]);

  const openRecent = useCallback(
    (nodeId: string | null) => {
      const node = nodeId ? catalog.getNode(nodeId) : undefined;
      if (node && node.ref) {
        navigate(nodeToPath(node));
        openChat();
        return;
      }
      navigate("/");
      openChat();
    },
    [navigate, openChat],
  );

  /** Compatibility shim for the existing Chat / ChatSessionList call sites. */
  const go = useCallback(
    (intent: NavIntent) => {
      if (intent.name === "openRecent") {
        openRecent(intent.nodeId ?? null);
        return;
      }
      if (intent.name === "assistant") {
        openChat();
        return;
      }
      if (intent.name === "chats") {
        navigate("/chats");
        return;
      }
      if (intent.name === "chat") {
        navigate("/");
        return;
      }
      navigate("/");
    },
    [navigate, openChat, openRecent],
  );

  return { openNode, selectProject, toggleOrg, openRecent, go };
}
