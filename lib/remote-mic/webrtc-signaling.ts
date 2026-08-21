import { randomUUID } from "crypto";
import type { RemoteMicRole } from "./config";

export type RemoteMicWebRtcOffer = {
  peerId: string;
  sessionId: string;
  role: RemoteMicRole;
  offer: unknown;
  answer: unknown | null;
  createdAt: number;
  updatedAt: number;
};

const OFFER_TTL_MS = 90_000;
const offers = new Map<string, RemoteMicWebRtcOffer>();

export function createRemoteMicWebRtcOffer(input: {
  sessionId: string;
  role: RemoteMicRole;
  offer: unknown;
}) {
  pruneExpiredOffers();

  for (const [peerId, offer] of offers.entries()) {
    if (offer.sessionId === input.sessionId && offer.role === input.role) {
      offers.delete(peerId);
    }
  }

  const now = Date.now();
  const offer: RemoteMicWebRtcOffer = {
    peerId: randomUUID(),
    sessionId: input.sessionId,
    role: input.role,
    offer: input.offer,
    answer: null,
    createdAt: now,
    updatedAt: now,
  };
  offers.set(offer.peerId, offer);

  return serializeOffer(offer);
}

export function listRemoteMicWebRtcOffers(sessionId: string) {
  pruneExpiredOffers();

  return Array.from(offers.values())
    .filter((offer) => offer.sessionId === sessionId && !offer.answer)
    .map(serializeOffer);
}

export function setRemoteMicWebRtcAnswer(input: {
  sessionId: string;
  role: RemoteMicRole;
  peerId: string;
  answer: unknown;
}) {
  pruneExpiredOffers();

  const offer = offers.get(input.peerId);
  if (
    !offer ||
    offer.sessionId !== input.sessionId ||
    offer.role !== input.role
  ) {
    return null;
  }

  offer.answer = input.answer;
  offer.updatedAt = Date.now();

  return serializeOffer(offer);
}

export function getRemoteMicWebRtcAnswer(input: {
  sessionId: string;
  role: RemoteMicRole;
  peerId: string;
}) {
  pruneExpiredOffers();

  const offer = offers.get(input.peerId);
  if (
    !offer ||
    offer.sessionId !== input.sessionId ||
    offer.role !== input.role
  ) {
    return null;
  }

  return offer.answer;
}

function serializeOffer(offer: RemoteMicWebRtcOffer) {
  return {
    peerId: offer.peerId,
    role: offer.role,
    offer: offer.offer,
    answer: offer.answer,
    createdAt: new Date(offer.createdAt).toISOString(),
    updatedAt: new Date(offer.updatedAt).toISOString(),
  };
}

function pruneExpiredOffers() {
  const minCreatedAt = Date.now() - OFFER_TTL_MS;

  for (const [peerId, offer] of offers.entries()) {
    if (offer.createdAt < minCreatedAt) {
      offers.delete(peerId);
    }
  }
}
