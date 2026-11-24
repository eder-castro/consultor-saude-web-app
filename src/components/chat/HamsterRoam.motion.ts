export const HAMSTER_ROAM_DELAY_MS = 20_000;
export const HAMSTER_ROAM_PET_WIDTH_PX = 62;

export interface RoamBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Pose {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

const SEGMENT_MS = 1900;
const route: Pose[] = [
  { x: 1, y: 0.26, scale: 1, rotation: 0 },
  { x: 1, y: 0.76, scale: 0.76, rotation: 90 },
  { x: 0, y: 0.76, scale: 0.64, rotation: 0 },
  { x: 0, y: 0.22, scale: 0.82, rotation: -90 },
  { x: 0.43, y: 0.48, scale: 0.42, rotation: 0 },
  { x: 0.82, y: 0.53, scale: 1.05, rotation: 0 },
  { x: 0.52, y: 0.34, scale: 1, rotation: 0 },
];

export function hamsterRoamPose(
  elapsed: number,
  start: { x: number; y: number },
  bounds: RoamBounds,
) {
  const clampX = (x: number) => Math.min(bounds.maxX, Math.max(bounds.minX, x));
  const clampY = (y: number) => Math.min(bounds.maxY, Math.max(bounds.minY, y));
  const point = (pose: Pose): Pose => ({
    ...pose,
    x: bounds.minX + pose.x * (bounds.maxX - bounds.minX),
    y: bounds.minY + pose.y * (bounds.maxY - bounds.minY),
  });
  const time = Math.max(0, elapsed);
  const segment = Math.floor(time / SEGMENT_MS);
  // Only the first segment originates at the wheel. Later laps connect the
  // last waypoint to the first, without teleporting back to the loading card.
  const from =
    segment === 0
      ? { x: start.x, y: start.y, scale: 1, rotation: 0 }
      : point(route[(segment - 1) % route.length]);
  const to = point(route[segment % route.length]);
  const progress = (time % SEGMENT_MS) / SEGMENT_MS;
  const eased = progress * progress * (3 - 2 * progress);
  return {
    x: clampX(from.x + (to.x - from.x) * eased),
    y: clampY(from.y + (to.y - from.y) * eased),
    scale: from.scale + (to.scale - from.scale) * eased,
    rotation: from.rotation + (to.rotation - from.rotation) * eased,
    facing: to.x < from.x ? -1 : 1,
  };
}

interface RoamRequest {
  start: () => void;
  stop: () => void;
  cancelled: boolean;
}

let currentOwner: RoamRequest | null = null;
const waitingOwners: RoamRequest[] = [];

export function claimHamsterRoam(start: () => void, stop: () => void): () => void {
  const request: RoamRequest = { start, stop, cancelled: false };

  const activateNext = () => {
    while (waitingOwners.length) {
      const next = waitingOwners.shift()!;
      if (!next.cancelled) {
        currentOwner = next;
        next.start();
        return;
      }
    }
  };

  const release = () => {
    request.cancelled = true;
    const queuedIndex = waitingOwners.indexOf(request);
    if (queuedIndex >= 0) waitingOwners.splice(queuedIndex, 1);
    if (currentOwner === request) {
      currentOwner = null;
      request.stop();
      activateNext();
    }
  };

  if (!currentOwner) {
    currentOwner = request;
    request.start();
  } else {
    waitingOwners.push(request);
  }
  return release;
}
