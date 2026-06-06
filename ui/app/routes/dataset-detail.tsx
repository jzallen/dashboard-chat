/* /project/:projectId/dataset/:datasetId — a staging dataset's detail. The
   entity IS a dataset (frontend/'s resource type is literally dataset|view|
   report); the old `table` path was a misnomer. */
import { useParams } from "react-router";

import { ResourceDetail } from "./_resourceDetail";

export default function DatasetDetailRoute() {
  const { datasetId } = useParams();
  return <ResourceDetail id={datasetId!} kind="dataset" />;
}
