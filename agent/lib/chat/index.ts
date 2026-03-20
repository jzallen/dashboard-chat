import { handleChat } from "./handleChat";

interface Env {
  GROQ_API_KEY: string;
}

export { handleChat } from "./handleChat";

export function createChatHandler(env: Env) {
  return (request: Request) => handleChat(request, env);
}
