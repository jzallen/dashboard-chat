/* /project/:projectId/dataset/:datasetId — a staging dataset's detail. */
import { useParams } from "react-router";

import { ResourceDetail } from "./_resourceDetail";

export default function DatasetDetailRoute() {
  const { datasetId } = useParams();
  return <ResourceDetail id={datasetId!} kind="dataset" />;
}
