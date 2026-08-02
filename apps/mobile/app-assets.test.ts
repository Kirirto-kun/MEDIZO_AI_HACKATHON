import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appConfig = require('./app.json').expo as {
  version: string;
  icon: string;
  plugins: (string | [string, Record<string, unknown>])[];
  ios: { buildNumber: string };
  android: {
    versionCode: number;
    softwareKeyboardLayoutMode: string;
    adaptiveIcon: {
      backgroundColor: string;
      foregroundImage: string;
      backgroundImage: string;
      monochromeImage: string;
    };
  };
};

const splashPlugin = appConfig.plugins.find(
  (plugin): plugin is [string, Record<string, unknown>] =>
    Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
);

const EXPO_TEMPLATE_HASHES = new Set([
  '119462bb78eb240a65c869fc067ee599639b3cb5a41953f25c07b17d2a8c7e0f',
  '9e3d0315a33c6799de601dd34cd8bf8cc3a8d16f3bf75592baec2ceb7240b391',
  'fb139c2dee362ebf2070e23b96da6fc0d43f8492de38b8af1fd7223e19b5861d',
  '6371fc2c12e33ad2215a86c281db3d682a81bebe7c957a842c13b8bf00cceb83',
  '5f4c0a732b6325bf4071d9124d2ae67e037cb24fcc9c482ef82bea742109a3b8',
]);

function readPng(relativePath: string) {
  const absolutePath = resolve(__dirname, relativePath);
  const contents = readFileSync(absolutePath);

  expect(contents.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
    colorType: contents[25],
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

describe('release branding', () => {
  it('uses the next installable release identity', () => {
    expect(appConfig.version).toBe('1.1.2');
    expect(appConfig.android.versionCode).toBe(4);
    expect(appConfig.ios.buildNumber).toBe('4');
  });

  it.each([
    [appConfig.icon, 1024, 1024, false],
    [appConfig.android.adaptiveIcon.foregroundImage, 1024, 1024, true],
    [appConfig.android.adaptiveIcon.backgroundImage, 1024, 1024, true],
    [appConfig.android.adaptiveIcon.monochromeImage, 432, 432, true],
    [splashPlugin?.[1].image, 1024, 1024, true],
  ])(
    'uses a branded PNG at %s',
    (relativePath, expectedWidth, expectedHeight, requiresAlpha) => {
      const image = readPng(relativePath as string);

      expect(image).toMatchObject({
        width: expectedWidth,
        height: expectedHeight,
      });
      if (requiresAlpha) {
        expect(image.colorType).toBe(6);
      }
      expect(EXPO_TEMPLATE_HASHES).not.toContain(image.sha256);
    },
  );

  it('keeps the adaptive and splash backgrounds on the DocJob navy', () => {
    expect(appConfig.android.adaptiveIcon.backgroundColor).toBe('#051620');
    expect(splashPlugin?.[1]).toMatchObject({
      backgroundColor: '#051620',
      dark: {
        backgroundColor: '#051620',
      },
    });
  });

  it('resizes the WebView when the Android keyboard opens', () => {
    expect(appConfig.android.softwareKeyboardLayoutMode).toBe('resize');
  });
});
