import { useInfiniteQuery } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import { type ApiError, createDataCatalog, type SessionsPage } from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";
import { sessionKeys } from "./queryKeys";

export { sessionKeys };

const catalog = createDataCatalog(withAuth(fetch));

const PAGE_SIZE = 30;

/** Fetches paginated sessions for a project with cursor-based pagination. */
export function useSessions(projectId: string | undefined) {
  return useInfiniteQuery<SessionsPage, ApiError>({
    queryKey: sessionKeys.list(projectId ?? ""),
    queryFn: ({ pageParam }) =>
      catalog.listSessions(projectId!, {
        after: pageParam as string | undefined,
        size: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.has_more ? lastPage.meta.next_cursor : undefined,
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.SESSION_LIST,
  });
}
