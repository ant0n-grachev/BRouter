import { z } from 'zod';
import type { Journey, RerouteMode } from './journey';

const JOURNEY_KEY = 'brouter:journey:v1';
const REROUTE_MODE_KEY = 'brouter:reroute-mode:v1';
const JOURNEY_EXPIRY_MS = 12 * 60 * 60 * 1_000;

const finiteNumber = z.number().finite();
const coordinateSchema = z.object({
  lat: finiteNumber.min(-90).max(90),
  lon: finiteNumber.min(-180).max(180),
});
const stationSchema = z.object({
  station_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  lat: finiteNumber.min(-90).max(90),
  lon: finiteNumber.min(-180).max(180),
  is_installed: z.boolean(),
  is_renting: z.boolean(),
  is_returning: z.boolean(),
  num_bikes_available: finiteNumber.min(0),
  num_docks_available: finiteNumber.min(0),
});
const destinationSchema = coordinateSchema.extend({ label: z.string().optional() });
const rerouteModeSchema = z.enum(['ask', 'automatic']);
const locationModeSchema = z.enum(['manual', 'device']);
const journeySchema = z
  .object({
    version: z.literal(1),
    id: z.string().trim().min(1),
    origin: coordinateSchema,
    destination: destinationSchema.nullable().default(null),
    pickup: stationSchema,
    dropoff: stationSchema.nullable().default(null),
    stage: z.enum(['pickup', 'ride', 'destination', 'complete']),
    rerouteMode: rerouteModeSchema,
    locationMode: locationModeSchema.default('manual'),
    startedAt: finiteNumber.min(0),
    updatedAt: finiteNumber.min(0),
  })
  .superRefine((journey, context) => {
    if (journey.updatedAt < journey.startedAt) {
      context.addIssue({
        code: 'custom',
        path: ['updatedAt'],
        message: 'updatedAt must not precede startedAt',
      });
    }
    if (Boolean(journey.destination) !== Boolean(journey.dropoff)) {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'destination and dropoff must either both be present or both be absent',
      });
    }
    if (journey.stage === 'ride' && !journey.dropoff) {
      context.addIssue({
        code: 'custom',
        path: ['stage'],
        message: 'ride stage requires a dropoff',
      });
    }
    if (
      (journey.stage === 'destination' || journey.stage === 'complete') &&
      (!journey.destination || !journey.dropoff)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stage'],
        message: 'destination and complete stages require full trip endpoints',
      });
    }
  });

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readJourney(now = Date.now()): Journey | null {
  try {
    const raw = storage()?.getItem(JOURNEY_KEY);
    if (!raw) return null;
    const parsedJson: unknown = JSON.parse(raw);
    const parsed = journeySchema.safeParse(parsedJson);
    if (!parsed.success || now - parsed.data.updatedAt > JOURNEY_EXPIRY_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeJourney(journey: Journey | null): void {
  try {
    const target = storage();
    if (!target) return;
    if (!journey) {
      target.removeItem(JOURNEY_KEY);
      return;
    }
    const parsed = journeySchema.safeParse(journey);
    if (parsed.success) target.setItem(JOURNEY_KEY, JSON.stringify(parsed.data));
  } catch {
    // Storage can be unavailable in private browsing or after quota exhaustion.
  }
}

export function readRerouteMode(): RerouteMode {
  try {
    const parsed = rerouteModeSchema.safeParse(storage()?.getItem(REROUTE_MODE_KEY));
    return parsed.success ? parsed.data : 'ask';
  } catch {
    return 'ask';
  }
}

export function writeRerouteMode(mode: RerouteMode): void {
  try {
    storage()?.setItem(REROUTE_MODE_KEY, mode);
  } catch {
    // Preference persistence must not block navigation.
  }
}
