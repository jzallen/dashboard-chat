import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { withAuth } from "@/auth";
import {
  type ApiError,
  createDataCatalog,
  type View,
  type ViewCreate,
  type ViewUpdate,
} from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";
import { viewKeys } from "./queryKeys";

export { viewKeys };

const catalog = createDataCatalog(withAuth(fetch));

/** Fetches the list of views for a project. */
export function useViewsQuery(projectId: string | undefined) {
  return useQuery<View[], ApiError>({
    queryKey: viewKeys.list(projectId ?? ""),
    queryFn: () => catalog.listViews(projectId!),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.VIEW_LIST,
    placeholderData: keepPreviousData,
  });
}

/** Fetches a single view by ID. */
export function useViewQuery(viewId: string | undefined) {
  return useQuery<View, ApiError>({
    queryKey: viewKeys.detail(viewId ?? ""),
    queryFn: () => catalog.getView(viewId!),
    enabled: Boolean(viewId),
    staleTime: QUERY_STALE_TIMES.VIEW_DETAIL,
  });
}

/** Creates a new view within a project. */
export function useCreateView(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ViewCreate) => catalog.createView(projectId, data),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: viewKeys.list(projectId),
        exact: true,
      });
    },
  });
}

/** Updates an existing view. */
export function useUpdateView(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ viewId, data }: { viewId: string; data: ViewUpdate }) =>
      catalog.updateView(viewId, data),
    onSettled: (_data, _err, { viewId }) => {
      queryClient.invalidateQueries({
        queryKey: viewKeys.detail(viewId),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: viewKeys.list(projectId),
        exact: true,
      });
    },
  });
}

/** Deletes a view. */
export function useDeleteView(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (viewId: string) => catalog.deleteView(viewId),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: viewKeys.list(projectId),
        exact: true,
      });
    },
  });
}
