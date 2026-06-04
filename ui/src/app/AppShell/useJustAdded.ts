/* The "a node was just created" flash — shared by source-upload and chat-model
   creation, read by the workspace canvas to briefly pop the new node. Lives at
   the shell level because that's where its producers and consumer meet. */
import { useCallback, useState } from "react";

export function useJustAdded() {
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const flash = useCallback((id: string) => {
    setJustAdded(id);
    setTimeout(() => setJustAdded(null), 1600);
  }, []);
  return { justAdded, flash };
}
