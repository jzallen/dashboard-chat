/* /report/:reportId — a mart report's detail. Mirrors frontend/app/routes/report-detail.tsx. */
import { useParams } from "react-router";

import { ResourceDetail } from "./_resourceDetail";

export default function ReportDetailRoute() {
  const { reportId } = useParams();
  return <ResourceDetail id={reportId!} kind="report" />;
}
