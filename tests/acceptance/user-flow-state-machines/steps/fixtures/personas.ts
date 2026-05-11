// Personas seeded for the J-001 acceptance suite. Adding a new persona is
// a one-file change per US-004 AC.

import type { PersonaConfig } from "../../harness/user-flow-harness.ts";

export const MAYA: PersonaConfig = {
  id: "user_maya_chen",
  email: "maya.chen@acme-data.example",
  display_name: "Maya Chen",
};

export const RAJESH: PersonaConfig = {
  id: "user_rajesh_singh",
  email: "rajesh.singh@returning-org.example",
  display_name: "Rajesh Singh",
};

export const PERSONAS: Record<string, PersonaConfig> = {
  maya: MAYA,
  rajesh: RAJESH,
};
