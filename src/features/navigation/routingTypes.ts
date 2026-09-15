import type { LatLon } from '../../types';

export interface RouteInstruction {
  text: string;
  distanceMeters: number;
  durationSeconds: number;
  geometryIndex: number;
}

export interface RoutedPath {
  geometry: LatLon[];
  instructions: RouteInstruction[];
  distanceMeters: number;
  durationSeconds: number;
}

export interface RoutingRequest {
  from: LatLon;
  to: LatLon;
  mode: 'walking' | 'bicycling';
}
