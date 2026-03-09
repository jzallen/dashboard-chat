import { useCallback, useRef } from "react";

import type { TableSchema } from "../../ui/types";

export interface EntityContextValue {
  projectId: string | null;
  entityType: "dataset" | null;
  entityId: string | null;
  tableSchema: TableSchema | null;
  setProjectId: (id: string | null) => void;
  setEntityType: (type: "dataset" | null) => void;
  setEntityId: (id: string | null) => void;
  setTableSchema: (schema: TableSchema | null) => void;
}

/**
 * Tracks entity context (project, entity type, entity ID, table schema)
 * independently of session state. Switching entities no longer resets the session.
 */
export function useEntityContext(): EntityContextValue {
  const projectIdRef = useRef<string | null>(null);
  const entityTypeRef = useRef<"dataset" | null>(null);
  const entityIdRef = useRef<string | null>(null);
  const tableSchemaRef = useRef<TableSchema | null>(null);

  const setProjectId = useCallback((id: string | null) => {
    projectIdRef.current = id;
  }, []);

  const setEntityType = useCallback((type: "dataset" | null) => {
    entityTypeRef.current = type;
  }, []);

  const setEntityId = useCallback((id: string | null) => {
    entityIdRef.current = id;
  }, []);

  const setTableSchema = useCallback((schema: TableSchema | null) => {
    tableSchemaRef.current = schema;
  }, []);

  return {
    get projectId() { return projectIdRef.current; },
    get entityType() { return entityTypeRef.current; },
    get entityId() { return entityIdRef.current; },
    get tableSchema() { return tableSchemaRef.current; },
    setProjectId,
    setEntityType,
    setEntityId,
    setTableSchema,
  };
}
