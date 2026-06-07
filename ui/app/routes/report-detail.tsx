/* /report/:reportId — a mart report's detail. */
import { useParams } from "react-router";

import { ResourceDetail } from "./_resourceDetail";

export default function ReportDetailRoute() {
  const { reportId } = useParams();
  return <ResourceDetail id={reportId!} kind="report" />;
}
