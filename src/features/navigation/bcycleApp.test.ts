import { describe, expect, it } from 'vitest';
import {
  BCYCLE_ANDROID_STORE_URL,
  BCYCLE_APP_URL,
  BCYCLE_IOS_STORE_URL,
  getBcycleStoreUrl,
} from './bcycleApp';

describe('BCycle app links', () => {
  it('provides the general app scheme without a rental action', () => {
    expect(BCYCLE_APP_URL).toBe('bcycle://');
  });

  it('selects Google Play for Android user agents', () => {
    expect(
      getBcycleStoreUrl(
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile',
      ),
    ).toBe('https://play.google.com/store/apps/details?id=com.bcycle');
    expect(BCYCLE_ANDROID_STORE_URL).toBe(
      'https://play.google.com/store/apps/details?id=com.bcycle',
    );
  });

  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X)'],
    ['unknown device', ''],
  ])('uses the App Store fallback for %s', (_device, userAgent) => {
    expect(getBcycleStoreUrl(userAgent)).toBe('https://apps.apple.com/us/app/bcycle/id371185597');
    expect(BCYCLE_IOS_STORE_URL).toBe('https://apps.apple.com/us/app/bcycle/id371185597');
  });
});
