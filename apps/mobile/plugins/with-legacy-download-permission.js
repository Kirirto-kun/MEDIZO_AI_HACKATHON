const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSION = 'android.permission.WRITE_EXTERNAL_STORAGE';
const RETIRED_READ_PERMISSION = 'android.permission.READ_EXTERNAL_STORAGE';

function applyLegacyDownloadPermission(manifest) {
  const current = manifest['uses-permission'] ?? [];
  const withoutLegacyEntries = current.filter(
    (entry) =>
      entry.$?.['android:name'] !== PERMISSION &&
      entry.$?.['android:name'] !== RETIRED_READ_PERMISSION,
  );

  return {
    ...manifest,
    'uses-permission': [
      ...withoutLegacyEntries,
      {
        $: {
          'android:name': PERMISSION,
          'android:maxSdkVersion': '28',
          'tools:replace': 'android:maxSdkVersion',
        },
      },
      {
        $: {
          'android:name': RETIRED_READ_PERMISSION,
          'tools:node': 'remove',
        },
      },
    ],
  };
}

/**
 * react-native-webview delegates downloads to Android's DownloadManager.
 * Android 7-9 require this legacy permission, while Android 10+ must not be
 * asked for broad storage access. Expo's plain `android.permissions` option
 * cannot express maxSdkVersion, so keep the narrowly-scoped manifest entry
 * in a config plugin that survives every `expo prebuild`.
 */
module.exports = function withLegacyDownloadPermission(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest = applyLegacyDownloadPermission(
      mod.modResults.manifest,
    );
    return mod;
  });
};

module.exports.applyLegacyDownloadPermission = applyLegacyDownloadPermission;
