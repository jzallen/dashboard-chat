import { useCallback, useRef } from "react";

import type { TableSchema } from "../../ui/types";

export type ContextType = "dataset" | "view" | null;

export interface EntityContextValue {
  projectId: string | null;
  entityType: ContextType;
  entityId: string | null;
  tableSchema: TableSchema | null;
  setProjectId: (id: string | null) => void;
  setEntityType: (type: ContextType) => void;
  setEntityId: (id: string | null) => void;
  setTableSchema: (schema: TableSchema | null) => void;
  setContext: (type: ContextType, id: string | null) => void;
}

/**
 * Tracks entity context (project, entity type, entity ID, table schema)
 * independently of session state. Switching entities no longer resets the session.
 */
export function useEntityContext(): EntityContextValue {
  const projectIdRef = useRef<string | null>(null);
  const entityTypeRef = useRef<ContextType>(null);
  const entityIdRef = useRef<string | null>(null);
  const tableSchemaRef = useRef<TableSchema | null>(null);

  const setProjectId = useCallback((id: string | null) => {
    projectIdRef.current = id;
  }, []);

  const setEntityType = useCallback((type: ContextType) => {
    entityTypeRef.current = type;
  }, []);

  const setEntityId = useCallback((id: string | null) => {
    entityIdRef.current = id;
  }, []);

  const setTableSchema = useCallback((schema: TableSchema | null) => {
    tableSchemaRef.current = schema;
  }, []);

  const setContext = useCallback((type: ContextType, id: string | null) => {
    entityTypeRef.current = type;
    entityIdRef.current = id;
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
    setContext,
  };
}
