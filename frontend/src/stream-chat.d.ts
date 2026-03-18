import "stream-chat";

declare module "stream-chat" {
  interface CustomChannelData {
    orgId?: string | null;
    projectId?: string | null;
    datasetId?: string | null;
    title?: string | null;
    createdAt?: string;
  }
}
