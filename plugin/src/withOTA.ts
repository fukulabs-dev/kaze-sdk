export interface ExpoConfigLike {
  name: string;
  slug: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ConfigPlugin<T = unknown> = (config: ExpoConfigLike, props?: T) => ExpoConfigLike;

// Native files patched by 0.1.0-beta.0/beta.1 reference the old com.otarn / Ota* names.
function migrateLegacyNames(contents: string): string {
  return contents
    .replaceAll('import com.otarn.OtaBundleLoader', 'import dev.fukulabs.kaze.KazeBundleLoader')
    .replaceAll('OtaBundleLoader', 'KazeBundleLoader');
}

export function modifyMainApplication(source: string): string {
  const contents = migrateLegacyNames(source);
  if (contents.includes('KazeBundleLoader.getJSBundleFile')) {
    return contents;
  }

  let updated = contents;
  if (!updated.includes('import dev.fukulabs.kaze.KazeBundleLoader')) {
    const packageIndex = updated.indexOf('package ');
    if (packageIndex !== -1) {
      const packageLineEnd = updated.indexOf('\n', packageIndex);
      updated =
        updated.slice(0, packageLineEnd + 1) +
        'import dev.fukulabs.kaze.KazeBundleLoader\n' +
        updated.slice(packageLineEnd + 1);
    }
  }

  // RN 0.80+ template: no ReactNativeHost, the bundle file is passed to getDefaultReactHost.
  const reactHostCall = /getDefaultReactHost\(\s*\n(\s*)context = applicationContext,/;
  if (!updated.includes('DefaultReactNativeHost(') && reactHostCall.test(updated)) {
    updated = updated.replace(
      reactHostCall,
      (match, indent: string) =>
        `${match}\n${indent}jsBundleFilePath = KazeBundleLoader.getJSBundleFile(applicationContext),`
    );
  } else if (updated.includes('override fun getJSBundleFile(): String?')) {
    updated = updated.replace(
      'override fun getJSBundleFile(): String? {',
      'override fun getJSBundleFile(): String? {\n        KazeBundleLoader.getJSBundleFile(applicationContext)?.let { return it }'
    );
  } else if (updated.includes('object : DefaultReactNativeHost(this) {')) {
    updated = updated.replace(
      'object : DefaultReactNativeHost(this) {',
      `object : DefaultReactNativeHost(this) {
          override fun getJSBundleFile(): String? {
            return KazeBundleLoader.getJSBundleFile(applicationContext) ?: super.getJSBundleFile()
          }`
    );
  } else if (updated.includes('override val reactNativeHost: ReactNativeHost =')) {
    updated = updated.replace(
      'override val reactNativeHost: ReactNativeHost =',
      `override val reactNativeHost: ReactNativeHost =
    object : DefaultReactNativeHost(this) {
      override fun getJSBundleFile(): String? {
        return KazeBundleLoader.getJSBundleFile(applicationContext) ?: super.getJSBundleFile()
      }
    } // kaze-ota-injected\n  val _origReactNativeHost =`
    );
  }

  return updated;
}

function swiftOtaOverride(indent: string, signature: string, fallbackCall: string): string {
  return [
    `${indent}${signature} {`,
    '#if !DEBUG',
    `${indent}  if let otaUrl = KazeBundleLoader.getJSBundleFile() {`,
    `${indent}    return otaUrl`,
    `${indent}  }`,
    '#endif',
    `${indent}  return ${fallbackCall}`,
    `${indent}}`,
    '',
  ].join('\n');
}

export function modifyAppDelegate(source: string): string {
  const contents = migrateLegacyNames(source);
  if (
    contents.includes('KazeBundleLoader.getJSBundleFile') ||
    contents.includes('KazeBundleLoader.bundleURL')
  ) {
    return contents;
  }

  let updated = contents;
  // The Swift module name comes from `s.module_name` in kaze-sdk.podspec.
  if (!updated.includes('import kaze_sdk') && !updated.includes('kaze_sdk-Swift.h')) {
    if (updated.includes('import UIKit')) {
      updated = updated.replace('import UIKit', 'import UIKit\nimport kaze_sdk');
    } else if (updated.includes('#import "AppDelegate.h"')) {
      updated = updated.replace(
        '#import "AppDelegate.h"',
        '#import "AppDelegate.h"\n#import <kaze_sdk/kaze_sdk-Swift.h>'
      );
    }
  }

  // Swift: the original body moves into a helper so implicit returns (`#if DEBUG expr #else expr`,
  // as in the RN 0.80+ SceneDelegate) keep compiling; the override tries the OTA bundle first.
  const bundleURLDecl = /^([ \t]*)override func bundleURL\(\) -> URL\? \{/m;
  const sourceURLDecl = /^([ \t]*)override func sourceURL\(for bridge: RCTBridge!\) -> URL! \{/m;
  if (bundleURLDecl.test(updated)) {
    updated = updated.replace(
      bundleURLDecl,
      (_match, indent: string) =>
        `${swiftOtaOverride(indent, 'override func bundleURL() -> URL?', 'kazeEmbeddedBundleURL()')}\n` +
        `${indent}func kazeEmbeddedBundleURL() -> URL? {`
    );
  } else if (sourceURLDecl.test(updated)) {
    updated = updated.replace(
      sourceURLDecl,
      (_match, indent: string) =>
        `${swiftOtaOverride(indent, 'override func sourceURL(for bridge: RCTBridge!) -> URL!', 'kazeEmbeddedSourceURL(for: bridge)')}\n` +
        `${indent}func kazeEmbeddedSourceURL(for bridge: RCTBridge!) -> URL! {`
    );
  } else if (updated.includes('- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge\n{')) {
    updated = updated.replace(
      '- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge\n{',
      '- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge\n{\n#if !DEBUG\n  NSURL *otaUrl = [KazeBundleLoader getJSBundleFile];\n  if (otaUrl) {\n    return otaUrl;\n  }\n#endif'
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
