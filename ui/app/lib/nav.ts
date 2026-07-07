/* Navigation intents — the URL-emitting layer. nodeToPath maps a lineage node
   to its project-scoped resource URL (the kind derives from the node's layer);
   useNavIntents wraps useNavigate/useParams so leaf views call openNode /
   selectProject / toggleOrg / openRecent / go, resolved against the
   project-in-path URL. Chat-open intents reach the useChat() context, never
   navigation. */
import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import type { LineageNode, ProjectSummary } from "../catalog";
import { modelKindForLayer } from "../catalog";
import { catalog } from "../components/useCatalog";
import { useChat } from "./chatContext";

/**
 * The deep-linkable URL for a lineage node, scoped to its project:
 * `/project/:projectId/{dataset|view|report}/:id`. The kind segment derives
 * from the node's layer (the domain 1:1 map), not the loose ModelRef bag, so a
 * missing/wrong `ref.kind` can't silently mis-route. projectId is REQUIRED —
 * project is part of a resource's identity at the API, so it lives in the path.
 *
 * Only ever called for non-source nodes (the chrome routes source-layer nodes
 * to their upload window, never here). A source layer yields no model kind, so
 * that is a programmer error and throws rather than mis-routing.
 */
export function nodeToPath(node: LineageNode, projectId: string): string {
  const kind = modelKindForLayer(node.layer);
  if (kind === undefined) {
    throw new Error(
      `nodeToPath: node ${node.id} is layer "${node.layer}" with no model kind`,
    );
  }
  return `/project/${projectId}/${kind}/${node.id}`;
}

/**
 * A nav request handed back from leaf views (Chat / ChatSessionList). A closed
 * union of the four real intents so the {@link useNavIntents} `go` dispatch is
 * exhaustive and call sites can only name an intent that exists:
 *   - `openRecent` re-opens a recent session, optionally on its backing node;
 *   - `assistant` opens the transient chat dock;
 *   - `chats` routes to the project session list;
 *   - `chat` routes back to the project home.
 */
export type NavIntent =
  | { name: "openRecent"; nodeId?: string | null }
  | { name: "assistant" }
  | { name: "chats" }
  | { name: "chat" };

/** Resolves a node id to its lineage node (or undefined). The default reaches
 *  the catalog singleton; injectable so the recent→node lookup is an explicit
 *  dependency rather than a hidden module import. */
export type NodeResolver = (nodeId: string) => LineageNode | undefined;

/**
 * The intent surface leaf views and the shell call. Navigation intents resolve
 * to URL changes (useNavigate); chat-open intents reach the useChat() setter.
 *
 * `resolveNode` is the seam for the openRecent lookup — it defaults to the
 * catalog singleton so production call sites need no argument, but making it a
 * parameter keeps that store dependency explicit and swappable.
 */
export function useNavIntents(resolveNode: NodeResolver = catalog.getNode) {
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
      const node = nodeId ? resolveNode(nodeId) : undefined;
      if (node && node.ref && projectId) {
        navigate(nodeToPath(node, projectId));
        openChat();
        return;
      }
      navigate(projectId ? "/project/" + projectId : "/");
      openChat();
    },
    [navigate, openChat, projectId, resolveNode],
  );

  /** Compatibility shim for the existing Chat / ChatSessionList call sites. */
  const go = useCallback(
    (intent: NavIntent) => {
      switch (intent.name) {
        case "openRecent":
          openRecent(intent.nodeId ?? null);
          return;
        case "assistant":
          openChat();
          return;
        case "chats":
          navigate(projectId ? "/project/" + projectId + "/chats" : "/");
          return;
        case "chat":
          navigate(projectId ? "/project/" + projectId : "/");
          return;
        default: {
          const _exhaustive: never = intent;
          return _exhaustive;
        }
      }
    },
    [navigate, openChat, openRecent, projectId],
  );

  return { openNode, selectProject, toggleOrg, openRecent, go };
}
