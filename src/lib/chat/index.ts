export { handleChat, type ChatClient, type ChatCompletionRequest } from "./handleChat";
export { GroqChatClient } from "./clients/groq";

import { handleChat } from "./handleChat";
import { GroqChatClient } from "./clients/groq";

interface Env {
  GROQ_API_KEY: string;
  CORS_ORIGIN: string;
}

export function createChatHandler(env: Env) {
  const client = new GroqChatClient(env.GROQ_API_KEY);
  return (request: Request) => handleChat(request, client, { corsOrigin: env.CORS_ORIGIN });
}
