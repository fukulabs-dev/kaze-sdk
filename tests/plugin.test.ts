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

  it('injects OtaBundleLoader into AppDelegate.swift', () => {
    const sampleAppDelegate = `import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
  override func sourceURL(for bridge: RCTBridge!) -> URL! {
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  }
}`;

    const modified = modifyAppDelegate(sampleAppDelegate);
    expect(modified).toContain('import OtaModule');
    expect(modified).toContain('OtaBundleLoader.getJSBundleFile()');
  });
});
