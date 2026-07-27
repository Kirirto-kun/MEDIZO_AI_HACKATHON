/* global describe, expect, it */

const {
  applyLegacyDownloadPermission,
} = require('./with-legacy-download-permission');

const WRITE_PERMISSION = 'android.permission.WRITE_EXTERNAL_STORAGE';
const READ_PERMISSION = 'android.permission.READ_EXTERNAL_STORAGE';

describe('with-legacy-download-permission', () => {
  it('overrides dependency permissions and removes legacy read access', () => {
    const manifest = applyLegacyDownloadPermission({
      'uses-permission': [
        { $: { 'android:name': 'android.permission.INTERNET' } },
        {
          $: {
            'android:name': WRITE_PERMISSION,
            'android:maxSdkVersion': '32',
          },
        },
        {
          $: {
            'android:name': READ_PERMISSION,
            'android:maxSdkVersion': '32',
          },
        },
      ],
    });

    expect(manifest['uses-permission']).toEqual([
      { $: { 'android:name': 'android.permission.INTERNET' } },
      {
        $: {
          'android:name': WRITE_PERMISSION,
          'android:maxSdkVersion': '28',
          'tools:replace': 'android:maxSdkVersion',
        },
      },
      {
        $: {
          'android:name': READ_PERMISSION,
          'tools:node': 'remove',
        },
      },
    ]);
  });

  it('is idempotent across repeated Expo prebuilds', () => {
    const once = applyLegacyDownloadPermission({});
    const twice = applyLegacyDownloadPermission(once);

    expect(twice).toEqual(once);
  });
});
