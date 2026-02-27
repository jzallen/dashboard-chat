export { GroqChatClient } from "./clients/groq";
export { type ChatClient, type ChatCompletionRequest,handleChat } from "./handleChat";

import { GroqChatClient } from "./clients/groq";
import { handleChat } from "./handleChat";

interface Env {
  GROQ_API_KEY: string;
}

export function createChatHandler(env: Env) {
  const client = new GroqChatClient(env.GROQ_API_KEY);
  return (request: Request) => handleChat(request, client);
}
