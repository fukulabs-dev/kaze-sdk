export interface ExpoConfigLike {
  name: string;
  slug: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ConfigPlugin<T = unknown> = (config: ExpoConfigLike, props?: T) => ExpoConfigLike;

export function modifyMainApplication(contents: string): string {
  if (contents.includes('OtaBundleLoader.getJSBundleFile')) {
    return contents;
  }

  let updated = contents;
  if (!updated.includes('import com.otarn.OtaBundleLoader')) {
    const packageIndex = updated.indexOf('package ');
    if (packageIndex !== -1) {
      const packageLineEnd = updated.indexOf('\n', packageIndex);
      updated =
        updated.slice(0, packageLineEnd + 1) +
        'import com.otarn.OtaBundleLoader\n' +
        updated.slice(packageLineEnd + 1);
    }
  }

  if (updated.includes('override fun getJSBundleFile(): String?')) {
    updated = updated.replace(
      'override fun getJSBundleFile(): String? {',
      'override fun getJSBundleFile(): String? {\n        OtaBundleLoader.getJSBundleFile(applicationContext)?.let { return it }'
    );
  } else if (updated.includes('object : DefaultReactNativeHost(this) {')) {
    updated = updated.replace(
      'object : DefaultReactNativeHost(this) {',
      `object : DefaultReactNativeHost(this) {
          override fun getJSBundleFile(): String? {
            return OtaBundleLoader.getJSBundleFile(applicationContext) ?: super.getJSBundleFile()
          }`
    );
  } else if (updated.includes('override val reactNativeHost: ReactNativeHost =')) {
    updated = updated.replace(
      'override val reactNativeHost: ReactNativeHost =',
      `override val reactNativeHost: ReactNativeHost =
    object : DefaultReactNativeHost(this) {
      override fun getJSBundleFile(): String? {
        return OtaBundleLoader.getJSBundleFile(applicationContext) ?: super.getJSBundleFile()
      }
    } // kaze-ota-injected\n  val _origReactNativeHost =`
    );
  }

  return updated;
}

export function modifyAppDelegate(contents: string): string {
  if (
    contents.includes('OtaBundleLoader.getJSBundleFile') ||
    contents.includes('OtaBundleLoader.bundleURL')
  ) {
    return contents;
  }

  let updated = contents;
  if (!updated.includes('import OtaModule') && !updated.includes('@import OtaModule;') && !updated.includes('OtaModule-Swift.h')) {
    if (updated.includes('import UIKit')) {
      updated = updated.replace('import UIKit', 'import UIKit\nimport OtaModule');
    } else if (updated.includes('#import "AppDelegate.h"')) {
      updated = updated.replace(
        '#import "AppDelegate.h"',
        '#import "AppDelegate.h"\n#import <OtaModule/OtaModule-Swift.h>'
      );
    }
  }

  if (updated.includes('override func bundleURL() -> URL? {')) {
    updated = updated.replace(
      'override func bundleURL() -> URL? {',
      'override func bundleURL() -> URL? {\n    if let otaUrl = OtaBundleLoader.getJSBundleFile() {\n        return otaUrl\n    }'
    );
  } else if (updated.includes('override func sourceURL(for bridge: RCTBridge!) -> URL! {')) {
    updated = updated.replace(
      'override func sourceURL(for bridge: RCTBridge!) -> URL! {',
      'override func sourceURL(for bridge: RCTBridge!) -> URL! {\n    if let otaUrl = OtaBundleLoader.getJSBundleFile() {\n        return otaUrl\n    }'
    );
  } else if (updated.includes('- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge\n{')) {
    updated = updated.replace(
      '- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge\n{',
      '- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge\n{\n  NSURL *otaUrl = [OtaBundleLoader getJSBundleFile];\n  if (otaUrl) {\n    return otaUrl;\n  }'
    );
  }

  return updated;
}

const withOTA: ConfigPlugin = (config) => {
  let modifiedConfig = {
    ...config,
    extra: {
      ...config.extra,
      otaEnabled: true,
    },
  };

  try {
    const expoPlugins = require('@expo/config-plugins');
    if (expoPlugins && typeof expoPlugins === 'object') {
      if (
        'withMainApplication' in expoPlugins &&
        typeof expoPlugins.withMainApplication === 'function'
      ) {
        modifiedConfig = expoPlugins.withMainApplication(
          modifiedConfig,
          (modConfig: { modResults?: { contents?: string } }) => {
            if (modConfig.modResults?.contents) {
              modConfig.modResults.contents = modifyMainApplication(
                modConfig.modResults.contents
              );
            }
            return modConfig;
          }
        );
      }
      if (
        'withAppDelegate' in expoPlugins &&
        typeof expoPlugins.withAppDelegate === 'function'
      ) {
        modifiedConfig = expoPlugins.withAppDelegate(
          modifiedConfig,
          (modConfig: { modResults?: { contents?: string } }) => {
            if (modConfig.modResults?.contents) {
              modConfig.modResults.contents = modifyAppDelegate(
                modConfig.modResults.contents
              );
            }
            return modConfig;
          }
        );
      }
    }
  } catch {
    // @expo/config-plugins not installed; fallback config returned
  }

  return modifiedConfig;
};

export default withOTA;
