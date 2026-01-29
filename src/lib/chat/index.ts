export { handleChat, type ChatClient, type ChatCompletionRequest } from "./handleChat";
export { GroqChatClient } from "./clients/groq";

import { handleChat } from "./handleChat";
import { GroqChatClient } from "./clients/groq";

interface Env {
  GROQ_API_KEY: string;
  CORS_ORIGIN?: string;
  API_URL?: string;
  DATASET_ID?: string;
}

export function createChatHandler(env: Env) {
  const client = new GroqChatClient(env.GROQ_API_KEY);
  // Default to "*" for development if CORS_ORIGIN not set
  const corsOrigin = env.CORS_ORIGIN || "*";
  const apiUrl = env.API_URL || "http://localhost:8000";
  const datasetId = env.DATASET_ID || "1592ce82-5f22-4da7-b41b-9fd9fd05770e";
  return (request: Request) =>
    handleChat(request, client, { corsOrigin, apiUrl, datasetId });
}
