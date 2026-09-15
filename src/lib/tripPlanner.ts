import type { LatLon, Station } from '../types';
import { haversineKm, kmToMiles } from './distance';

export type TripDestination = LatLon & { label?: string };

export interface TripLeg {
  title: 'Walk to pickup' | 'Ride to dropoff' | 'Walk to destination';
  mode: 'walking' | 'bicycling';
  from: LatLon;
  to: LatLon;
  fromDescription: string;
  toDescription: string;
  distanceMi: number;
}

export interface TripPlan {
  pickup: Station;
  dropoff: Station;
  legs: [TripLeg, TripLeg, TripLeg];
  dWalk1Mi: number;
  dBikeMi: number;
  dWalk2Mi: number;
}

function destinationDescription(destination: TripDestination): string {
  return destination.label?.trim() || 'Destination';
}

export function createTripPlan(
  origin: LatLon,
  destination: TripDestination,
  pickup: Station,
  dropoff: Station,
): TripPlan {
  const pickupPoint = { lat: pickup.lat, lon: pickup.lon };
  const dropoffPoint = { lat: dropoff.lat, lon: dropoff.lon };
  const dWalk1Mi = kmToMiles(haversineKm(origin, pickupPoint));
  const dBikeMi = kmToMiles(haversineKm(pickupPoint, dropoffPoint));
  const dWalk2Mi = kmToMiles(haversineKm(dropoffPoint, destination));
  const legs: TripPlan['legs'] = [
    {
      title: 'Walk to pickup',
      mode: 'walking',
      from: origin,
      to: pickupPoint,
      fromDescription: 'Current location',
      toDescription: pickup.name,
      distanceMi: dWalk1Mi,
    },
    {
      title: 'Ride to dropoff',
      mode: 'bicycling',
      from: pickupPoint,
      to: dropoffPoint,
      fromDescription: pickup.name,
      toDescription: dropoff.name,
      distanceMi: dBikeMi,
    },
    {
      title: 'Walk to destination',
      mode: 'walking',
      from: dropoffPoint,
      to: destination,
      fromDescription: dropoff.name,
      toDescription: destinationDescription(destination),
      distanceMi: dWalk2Mi,
    },
  ];
  return { pickup, dropoff, legs, dWalk1Mi, dBikeMi, dWalk2Mi };
}
