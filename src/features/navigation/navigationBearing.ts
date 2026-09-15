export type CameraMode = 'overview' | 'follow' | 'free';

export function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function resolveNavigationHeading(
  compass: number | null,
  course: number | null | undefined,
) {
  const valid = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360;
  if (valid(compass)) return { heading: compass, source: 'compass' } as const;
  if (valid(course)) return { heading: course, source: 'gps' } as const;
  return { heading: null, source: 'none' } as const;
}

export function mapBearingTarget(
  mode: CameraMode,
  locationEnabled: boolean,
  heading: number | null,
): number | null {
  if (!locationEnabled || mode === 'overview') return 0;
  if (mode === 'free') return null;
  return heading === null ? 0 : normalizeBearing(-heading);
}
