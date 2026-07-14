import type { Prisma } from "@prisma/client";
import type { AcpSlotState } from "./acp-mvp";

type AppSessionInput = {
  id: string;
  participantCode: string | null;
  condition: string | null;
  startedAt: Date;
  endedAt?: Date | null;
};

type AppUtteranceInput = {
  id: string;
  sessionId: string;
  speaker: string;
  text: string;
  createdAt: Date;
};

export async function ensureStudySessionForAppSession(
  _session: AppSessionInput,
) {
  return null;
}

export async function saveStudyUtteranceForAppUtterance(
  _utterance: AppUtteranceInput,
) {
  return null;
}

export async function deleteStudyUtteranceForAppUtterance(
  _appUtteranceId: string,
  _appSessionId: string,
) {
  return null;
}

export async function saveStudySlotStatesForSession(
  _appSessionId: string,
  _slots: AcpSlotState[],
) {
  return null;
}

export function toResearchJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
