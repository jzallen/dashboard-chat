/* Navigation intents — the URL-emitting layer that replaces useNavigation.ts.
   nodeToPath maps a lineage node to its project-scoped resource URL (the kind
   lives on node.ref.kind); useNavIntents wraps useNavigate/useParams so leaf
   views keep calling openNode / selectProject / toggleOrg / openRecent / go, now
   resolved against the project-in-path URL. Chat-open intents reach the
   useChat() context, never navigation. */
import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import type { LineageNode, ProjectSummary } from "../catalog";
import { catalog } from "../components/useCatalog";
import { useChat } from "./chatContext";

/** The node kind discriminant, read off the loose ModelRef bag. */
function kindOf(node: LineageNode): string | undefined {
  return node.ref?.kind as string | undefined;
}

/** The resource path segment for a node's kind (bare singular). */
const KIND_PREFIX: Record<string, string> = {
  dataset: "dataset",
  view: "view",
  report: "report",
};

/**
 * The deep-linkable URL for a lineage node, scoped to its project:
 * `/project/:projectId/{dataset|view|report}/:id`. projectId is REQUIRED —
 * project is part of a resource's identity at the API, so it lives in the path.
 * Mirrors the nested resource routes so a later merge into frontend/ is
 * mechanical (frontend uses plural/top-level; reconciled at merge).
 */
export function nodeToPath(node: LineageNode, projectId: string): string {
  const prefix = KIND_PREFIX[kindOf(node) ?? ""] ?? "dataset";
  return `/project/${projectId}/${prefix}/${node.id}`;
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
  const { projectId } = useParams();
  const { openChat } = useChat();

  const openNode = useCallback(
    (node: LineageNode) => {
      navigate(nodeToPath(node, projectId!));
    },
    [navigate, projectId],
  );

  const selectProject = useCallback(
    (project: ProjectSummary) => {
      // Project is navigable identity now: PUSH so Back traverses projects.
      navigate("/project/" + project.id);
    },
    [navigate],
  );

  const toggleOrg = useCallback(() => {
    if (location.pathname === "/org") {
      // A direct /org deep-link has no prior entry; fall to the home redirect.
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
      if (node && node.ref && projectId) {
        navigate(nodeToPath(node, projectId));
        openChat();
        return;
      }
      navigate(projectId ? "/project/" + projectId : "/");
      openChat();
    },
    [navigate, openChat, projectId],
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
        navigate(projectId ? "/project/" + projectId + "/chats" : "/");
        return;
      }
      if (intent.name === "chat") {
        navigate(projectId ? "/project/" + projectId : "/");
        return;
      }
      navigate(projectId ? "/project/" + projectId : "/");
    },
    [navigate, openChat, openRecent, projectId],
  );

  return { openNode, selectProject, toggleOrg, openRecent, go };
}
