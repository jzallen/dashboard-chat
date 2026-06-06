/* /table/:datasetId — a staging dataset's detail. Mirrors frontend/app/routes/table.tsx. */
import { useParams } from "react-router";

import { ResourceDetail } from "./_resourceDetail";

export default function TableRoute() {
  const { datasetId } = useParams();
  return <ResourceDetail id={datasetId!} kind="dataset" />;
}
