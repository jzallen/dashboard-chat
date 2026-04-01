import { useMutation, useQueryClient } from "@tanstack/react-query";

import { withAuth } from "@/auth";
import { createDataCatalog, type Session } from "@/dataCatalog";

import { sessionKeys } from "./queryKeys";

const catalog = createDataCatalog(withAuth(fetch));

/** Creates a new session in the given project and invalidates the session list cache. */
export function useCreateSession(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<Session, Error>({
    mutationFn: () => catalog.createSession(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: sessionKeys.list(projectId),
      });
    },
  });
}
