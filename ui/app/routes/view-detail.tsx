/* /view/:viewId — an intermediate view's detail. */
import { useParams } from "react-router";

import { ResourceDetail } from "./_resourceDetail";

export default function ViewDetailRoute() {
  const { viewId } = useParams();
  return <ResourceDetail id={viewId!} kind="view" />;
}
