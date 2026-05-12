import { useMutation, useQueryClient } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import { createDataCatalog, type Session, type SessionsPage } from "@/dataCatalog";

import { sessionKeys } from "./queryKeys";

const catalog = createDataCatalog(withAuth(fetch));

/** Updates a session title with optimistic updates to the session list cache. */
export function useUpdateSession(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    Session,
    Error,
    { sessionId: string; title: string },
    { previousPages: SessionsPage[] | undefined }
  >({
    mutationFn: ({ sessionId, title }) =>
      catalog.updateSession(projectId, sessionId, { title }),

    onMutate: async ({ sessionId, title }) => {
      await queryClient.cancelQueries({
        queryKey: sessionKeys.list(projectId),
      });

      const queryData = queryClient.getQueryData<{
        pages: SessionsPage[];
        pageParams: unknown[];
      }>(sessionKeys.list(projectId));

      const previousPages = queryData?.pages;

      if (queryData) {
        queryClient.setQueryData(sessionKeys.list(projectId), {
          ...queryData,
          pages: queryData.pages.map((page) => ({
            ...page,
            data: page.data.map((s) =>
              s.id === sessionId ? { ...s, title } : s,
            ),
          })),
        });
      }

      return { previousPages };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousPages) {
        const queryData = queryClient.getQueryData<{
          pages: SessionsPage[];
          pageParams: unknown[];
        }>(sessionKeys.list(projectId));
        if (queryData) {
          queryClient.setQueryData(sessionKeys.list(projectId), {
            ...queryData,
            pages: context.previousPages,
          });
        }
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: sessionKeys.list(projectId),
      });
    },
  });
}
