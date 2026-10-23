import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import withOTA, { modifyMainApplication, modifyAppDelegate, applyOTAPlugin } from '../plugin/src/withOTA';
import type { ExpoConfigPlugins } from '../plugin/src/withOTA';

describe('Expo Config Plugin withOTA', () => {
  it('adds required native configurations to app config', () => {
    const rawConfig = {
      name: 'TestApp',
      slug: 'test-app',
    };
    const modified = withOTA(rawConfig);
    expect(modified.extra?.otaEnabled).toBe(true);
  });

  it('injects KazeBundleLoader into MainApplication.kt', () => {
    const sampleMainApplication = `package com.example.app

class MainApplication : Application(), ReactApplication {
  override fun getJSBundleFile(): String? {
    return super.getJSBundleFile()
  }
}`;

    const modified = modifyMainApplication(sampleMainApplication);
    expect(modified).toContain('import dev.fukulabs.kaze.KazeBundleLoader');
    expect(modified).toContain('KazeBundleLoader.getJSBundleFile(applicationContext)');
  });

  it('passes the OTA bundle to getDefaultReactHost in the RN 0.80+ template', () => {
    const sampleMainApplication = `package com.example.app

import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
        },
    )
  }
}`;

    const modified = modifyMainApplication(sampleMainApplication);
    expect(modified).toContain('import dev.fukulabs.kaze.KazeBundleLoader');
    expect(modified).toContain(
      '      context = applicationContext,\n      jsBundleFilePath = KazeBundleLoader.getJSBundleFile(applicationContext),'
    );
    expect(modifyMainApplication(modified)).toBe(modified);
  });

  it('injects KazeBundleLoader into AppDelegate.swift', () => {
    const sampleAppDelegate = `import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
  override func sourceURL(for bridge: RCTBridge!) -> URL! {
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  }
}`;

    const modified = modifyAppDelegate(sampleAppDelegate);
    expect(modified).toContain('import kaze_sdk');
    expect(modified).not.toContain('import OtaModule');
    expect(modified).not.toContain('OtaBundleLoader');
    expect(modified).toContain('KazeBundleLoader.getJSBundleFile()');
    expect(modified).toMatch(/#if !DEBUG\n\s+if let otaUrl = KazeBundleLoader\.getJSBundleFile\(\)[\s\S]*?#endif/);
  });

  it('keeps implicit returns compiling in the RN 0.80+ SceneDelegate bundleURL', () => {
    const sceneDelegate = `import React
import UIKit

class SceneDelegate: RCTDefaultReactNativeFactoryDelegate, UIWindowSceneDelegate {
  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}`;

    const modified = modifyAppDelegate(sceneDelegate);
    expect(modified).toContain('import kaze_sdk');
    expect(modified).toContain(
      '  override func bundleURL() -> URL? {\n#if !DEBUG\n    if let otaUrl = KazeBundleLoader.getJSBundleFile() {\n      return otaUrl\n    }\n#endif\n    return kazeEmbeddedBundleURL()\n  }\n'
    );
    // The original body, implicit returns included, becomes the helper.
    expect(modified).toContain('  func kazeEmbeddedBundleURL() -> URL? {\n    #if DEBUG\n    RCTBundleURLProvider');
    expect(modifyAppDelegate(modified)).toBe(modified);
  });

  it('migrates files patched with the old com.otarn / OtaBundleLoader names', () => {
    const oldMainApplication = `package com.example.app
import com.otarn.OtaBundleLoader

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      jsBundleFilePath = OtaBundleLoader.getJSBundleFile(applicationContext),
      packageList = PackageList(this).packages,
    )
  }
}`;
    const migrated = modifyMainApplication(oldMainApplication);
    expect(migrated).toContain('import dev.fukulabs.kaze.KazeBundleLoader');
    expect(migrated).toContain('jsBundleFilePath = KazeBundleLoader.getJSBundleFile(applicationContext)');
    expect(migrated).not.toMatch(/otarn|OtaBundleLoader/);
    expect(migrated.match(/getJSBundleFile/g)).toHaveLength(1);

    const oldSwift = 'import kaze_sdk\n  if let otaUrl = OtaBundleLoader.getJSBundleFile() {';
    expect(modifyAppDelegate(oldSwift)).toBe('import kaze_sdk\n  if let otaUrl = KazeBundleLoader.getJSBundleFile() {');
  });
});

describe('Expo Config Plugin warnings', () => {
  const PATCHABLE_MAIN = `package com.example.app

class MainApplication : Application(), ReactApplication {
  override fun getJSBundleFile(): String? {
    return super.getJSBundleFile()
  }
}`;
  const PATCHABLE_DELEGATE = `import UIKit

class AppDelegate: ExpoAppDelegate {
  override func bundleURL() -> URL? {
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  }
}`;

  function runPlugin(main: string, delegate: string, projectRoot?: string) {
    const warnings: string[] = [];
    const plugins: ExpoConfigPlugins = {
      WarningAggregator: {
        addWarningAndroid: (_property, text) => warnings.push(`android: ${text}`),
        addWarningIOS: (_property, text) => warnings.push(`ios: ${text}`),
      },
      withMainApplication: (config, action) => {
        action({ modResults: { contents: main } });
        return config;
      },
      withAppDelegate: (config, action) => {
        action({ modResults: { contents: delegate } });
        return config;
      },
    };
    applyOTAPlugin({ name: 'TestApp', slug: 'test-app', _internal: { projectRoot } }, plugins);
    return warnings;
  }

  it('stays quiet when both native entry points are patched', () => {
    expect(runPlugin(PATCHABLE_MAIN, PATCHABLE_DELEGATE)).toEqual([]);
  });

  it('warns when a native entry point matches no known template', () => {
    const warnings = runPlugin(
      'package com.example.app\n\nclass MainApplication : Application()',
      'import UIKit\n\nclass AppDelegate: UIResponder {}'
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^android: MainApplication could not be patched/);
    expect(warnings[1]).toMatch(/^ios: AppDelegate could not be patched/);
  });

  it('warns when expo-updates is installed in the project', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'kaze-plugin-'));
    try {
      mkdirSync(join(projectRoot, 'node_modules', 'expo-updates'), { recursive: true });
      writeFileSync(join(projectRoot, 'node_modules', 'expo-updates', 'package.json'), '{"name":"expo-updates"}');

      const warnings = runPlugin(PATCHABLE_MAIN, PATCHABLE_DELEGATE, projectRoot);
      expect(warnings).toEqual([expect.stringMatching(/^android: expo-updates is installed/)]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
