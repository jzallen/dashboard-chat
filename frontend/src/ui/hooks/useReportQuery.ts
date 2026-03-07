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
  type Report,
  type ReportCreate,
  type ReportUpdate,
} from "@/dataCatalog";

import { QUERY_STALE_TIMES } from "./queryConfig";
import { reportKeys } from "./queryKeys";

export { reportKeys };

const catalog = createDataCatalog(withAuth(fetch));

/** Fetches the list of reports for a project. */
export function useReportsQuery(projectId: string | undefined) {
  return useQuery<Report[], ApiError>({
    queryKey: reportKeys.list(projectId ?? ""),
    queryFn: () => catalog.listReports(projectId!),
    enabled: Boolean(projectId),
    staleTime: QUERY_STALE_TIMES.REPORT_LIST,
    placeholderData: keepPreviousData,
  });
}

/** Fetches a single report by ID. */
export function useReportQuery(reportId: string | undefined) {
  return useQuery<Report, ApiError>({
    queryKey: reportKeys.detail(reportId ?? ""),
    queryFn: () => catalog.getReport(reportId!),
    enabled: Boolean(reportId),
    staleTime: QUERY_STALE_TIMES.REPORT_DETAIL,
  });
}

/** Creates a new report within a project. */
export function useCreateReport(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ReportCreate) => catalog.createReport(projectId, data),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: reportKeys.list(projectId),
        exact: true,
      });
    },
  });
}

/** Updates an existing report. */
export function useUpdateReport(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      reportId,
      data,
    }: {
      reportId: string;
      data: ReportUpdate;
    }) => catalog.updateReport(reportId, data),
    onSettled: (_data, _err, { reportId }) => {
      queryClient.invalidateQueries({
        queryKey: reportKeys.detail(reportId),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: reportKeys.list(projectId),
        exact: true,
      });
    },
  });
}

/** Deletes a report. */
export function useDeleteReport(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reportId: string) => catalog.deleteReport(reportId),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: reportKeys.list(projectId),
        exact: true,
      });
    },
  });
}
