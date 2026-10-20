import { describe, it, expect } from 'vitest';
import withOTA, { modifyMainApplication, modifyAppDelegate } from '../plugin/src/withOTA';

describe('Expo Config Plugin withOTA', () => {
  it('adds required native configurations to app config', () => {
    const rawConfig = {
      name: 'TestApp',
      slug: 'test-app',
    };
    const modified = withOTA(rawConfig);
    expect(modified.extra?.otaEnabled).toBe(true);
  });

  it('injects OtaBundleLoader into MainApplication.kt', () => {
    const sampleMainApplication = `package com.example.app

class MainApplication : Application(), ReactApplication {
  override fun getJSBundleFile(): String? {
    return super.getJSBundleFile()
  }
}`;

    const modified = modifyMainApplication(sampleMainApplication);
    expect(modified).toContain('import com.otarn.OtaBundleLoader');
    expect(modified).toContain('OtaBundleLoader.getJSBundleFile(applicationContext)');
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
    expect(modified).toContain('import com.otarn.OtaBundleLoader');
    expect(modified).toContain(
      '      context = applicationContext,\n      jsBundleFilePath = OtaBundleLoader.getJSBundleFile(applicationContext),'
    );
    expect(modifyMainApplication(modified)).toBe(modified);
  });

  it('injects OtaBundleLoader into AppDelegate.swift', () => {
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
    expect(modified).toContain('OtaBundleLoader.getJSBundleFile()');
    expect(modified).toMatch(/#if !DEBUG\n\s+if let otaUrl = OtaBundleLoader\.getJSBundleFile\(\)[\s\S]*?#endif/);
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
      '  override func bundleURL() -> URL? {\n#if !DEBUG\n    if let otaUrl = OtaBundleLoader.getJSBundleFile() {\n      return otaUrl\n    }\n#endif\n    return kazeEmbeddedBundleURL()\n  }\n'
    );
    // The original body, implicit returns included, becomes the helper.
    expect(modified).toContain('  func kazeEmbeddedBundleURL() -> URL? {\n    #if DEBUG\n    RCTBundleURLProvider');
    expect(modifyAppDelegate(modified)).toBe(modified);
  });
});
