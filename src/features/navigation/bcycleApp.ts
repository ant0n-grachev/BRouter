// Public discovery scheme and store links published by Madison BCycle's GBFS feed:
// https://gbfs.bcycle.com/bcycle_madison/system_information.json
export const BCYCLE_APP_URL = 'bcycle://';
export const BCYCLE_IOS_STORE_URL = 'https://apps.apple.com/us/app/bcycle/id371185597';
export const BCYCLE_ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.bcycle';

export function getBcycleStoreUrl(userAgent?: string): string {
  const resolvedUserAgent = userAgent ?? globalThis.navigator?.userAgent ?? '';
  return /android/i.test(resolvedUserAgent) ? BCYCLE_ANDROID_STORE_URL : BCYCLE_IOS_STORE_URL;
}
