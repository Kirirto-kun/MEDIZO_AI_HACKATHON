/* global describe, expect, it */

const {
  injectSecureReleaseSigning,
} = require('./with-secure-release-signing');

const expoTemplate = `
def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
        }
    }
}
`;

describe('with-secure-release-signing', () => {
  it('gates only release tasks and never embeds signing secrets', () => {
    const output = injectSecureReleaseSigning(expoTemplate);

    expect(output).toContain('gradle.taskGraph.whenReady');
    expect(output).toContain("task.name.toLowerCase().contains('release')");
    expect(output).toContain('if (releaseTaskRequested && !releaseSigningEnvironmentComplete)');
    expect(output).toContain('if (releaseSigningEnvironmentComplete)');
    expect(output).toContain('signingConfig signingConfigs.release');
    expect(output).not.toContain('signingConfig signingConfigs.debug');
  });

  it('is idempotent across repeated Expo prebuilds', () => {
    const once = injectSecureReleaseSigning(expoTemplate);
    const twice = injectSecureReleaseSigning(once);

    expect(twice).toBe(once);
    expect(twice.match(/gradle\.taskGraph\.whenReady/g)).toHaveLength(1);
    expect(twice.match(/releaseSigningEnvironmentComplete = \[/g)).toHaveLength(1);
  });
});
