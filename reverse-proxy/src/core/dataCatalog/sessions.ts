/**
 * Sessions & Memory API — Types
 *
 * Domain functions are provided by createDataCatalog() in ./client.ts.
 * This file exports only types used by the factory and consumers.
 */

export interface ProjectMemory {
  id: string;
  project_id: string;
  org_id: string;
  stream_channel_id: string;
  created_at: string;
}

export interface Session {
  id: string;
  memory_id: string;
  stream_thread_id: string;
  owner_id: string;
  title: string | null;
  org_id: string;
  created_at: string;
  last_active_at: string;
}

export interface SessionsPage {
  data: Session[];
  meta: {
    next_cursor: string | null;
    has_more: boolean;
  };
}
