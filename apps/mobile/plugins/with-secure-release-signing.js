const { withAppBuildGradle } = require('expo/config-plugins');

const LEGACY_ENV_BLOCK = `
def releaseKeystorePath = System.getenv('DOCJOB_ANDROID_KEYSTORE')
def releaseKeystorePassword = System.getenv('DOCJOB_ANDROID_STORE_PASSWORD')
def releaseKeyAlias = System.getenv('DOCJOB_ANDROID_KEY_ALIAS')
def releaseKeyPassword = System.getenv('DOCJOB_ANDROID_KEY_PASSWORD')
`;

const ENV_BLOCK = `${LEGACY_ENV_BLOCK.trimEnd()}
def releaseSigningEnvironmentComplete = [
    releaseKeystorePath,
    releaseKeystorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
].every { it != null && !it.isEmpty() }

gradle.taskGraph.whenReady { taskGraph ->
    def releaseTaskRequested = taskGraph.allTasks.any { task ->
        task.name.toLowerCase().contains('release')
    }
    if (releaseTaskRequested && !releaseSigningEnvironmentComplete) {
        throw new GradleException('Release signing environment is incomplete.')
    }
}
`;

const LEGACY_RELEASE_SIGNING_CONFIG = `        release {
            if (!releaseKeystorePath || !releaseKeystorePassword || !releaseKeyAlias || !releaseKeyPassword) {
                throw new GradleException('Release signing environment is incomplete.')
            }
            storeFile file(releaseKeystorePath)
            storePassword releaseKeystorePassword
            keyAlias releaseKeyAlias
            keyPassword releaseKeyPassword
}
`;

const RELEASE_SIGNING_CONFIG = `        release {
            if (releaseSigningEnvironmentComplete) {
                storeFile file(releaseKeystorePath)
                storePassword releaseKeystorePassword
                keyAlias releaseKeyAlias
                keyPassword releaseKeyPassword
            }
        }
`;

function injectSecureReleaseSigning(source) {
  let contents = source;
  const jscLine = "def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'";
  const envMarker = 'def releaseSigningEnvironmentComplete = [';

  if (contents.includes(LEGACY_ENV_BLOCK.trim()) && !contents.includes(envMarker)) {
    contents = contents.replace(LEGACY_ENV_BLOCK.trim(), ENV_BLOCK.trim());
  } else if (!contents.includes(envMarker)) {
    if (!contents.includes(jscLine)) {
      throw new Error('Unable to locate the Expo JSC configuration in app/build.gradle');
    }
    contents = contents.replace(jscLine, `${jscLine}\n${ENV_BLOCK.trimEnd()}`);
  }

  const debugSigningConfig = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
`;
  const releaseConfigMarker =
    '        release {\n            if (releaseSigningEnvironmentComplete) {';

  if (contents.includes(LEGACY_RELEASE_SIGNING_CONFIG)) {
    contents = contents.replace(LEGACY_RELEASE_SIGNING_CONFIG, RELEASE_SIGNING_CONFIG);
  } else if (!contents.includes(releaseConfigMarker)) {
    if (!contents.includes(debugSigningConfig)) {
      throw new Error('Unable to locate the Expo debug signing configuration');
    }
    contents = contents.replace(
      debugSigningConfig,
      `${debugSigningConfig}${RELEASE_SIGNING_CONFIG}`,
    );
  }

  const debugReleaseSigning = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
  if (contents.includes(debugReleaseSigning)) {
    contents = contents.replace(
      debugReleaseSigning,
      '            signingConfig signingConfigs.release',
    );
  } else if (!contents.includes('            signingConfig signingConfigs.release')) {
    throw new Error('Unable to locate the Expo release signing configuration');
  }

  return contents;
}

/**
 * Expo's Android template signs release APKs with the debug key. Make every
 * release task fail closed unless the four local-only signing variables are
 * present, while keeping normal debug/prebuild workflows usable.
 */
module.exports = function withSecureReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('DocJob release signing requires a Groovy app/build.gradle');
    }

    mod.modResults.contents = injectSecureReleaseSigning(mod.modResults.contents);
    return mod;
  });
};

module.exports.injectSecureReleaseSigning = injectSecureReleaseSigning;
