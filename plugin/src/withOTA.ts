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
  if (hasAndroidLoader(contents)) {
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
  if (hasIOSLoader(contents)) {
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

const PLUGIN_NAME = '@fukulabs/kaze-sdk';

interface ExpoPluginsLike {
  WarningAggregator?: {
    addWarningAndroid?: (property: string, text: string) => void;
    addWarningIOS?: (property: string, text: string) => void;
  };
}

// Shown in the `npx expo prebuild` summary; console otherwise.
function warn(expoPlugins: ExpoPluginsLike, platform: 'android' | 'ios', text: string): void {
  const aggregator = expoPlugins.WarningAggregator;
  const add = platform === 'android' ? aggregator?.addWarningAndroid : aggregator?.addWarningIOS;
  if (typeof add === 'function') {
    add(PLUGIN_NAME, text);
  } else {
    console.warn(`[${PLUGIN_NAME}] ${text}`);
  }
}

export function hasAndroidLoader(contents: string): boolean {
  return contents.includes('KazeBundleLoader.getJSBundleFile');
}

export function hasIOSLoader(contents: string): boolean {
  return contents.includes('KazeBundleLoader.getJSBundleFile') || contents.includes('KazeBundleLoader.bundleURL');
}

const NOT_PATCHED =
  'could not be patched to load OTA bundles, so updates will download but never run. ' +
  'Add the Kaze loader by hand as described in the README (Bare React Native setup), or open an issue with the file attached.';

function isExpoUpdatesInstalled(projectRoot: string | undefined): boolean {
  try {
    require.resolve('expo-updates/package.json', { paths: [projectRoot ?? process.cwd()] });
    return true;
  } catch {
    return false;
  }
}

type ModConfig = { modResults?: { contents?: string } };
type WithMod = (config: ExpoConfigLike, action: (modConfig: ModConfig) => ModConfig) => ExpoConfigLike;

/** The parts of @expo/config-plugins the plugin uses; passed in so tests can supply a fake. */
export interface ExpoConfigPlugins extends ExpoPluginsLike {
  withMainApplication?: WithMod;
  withAppDelegate?: WithMod;
}

export function applyOTAPlugin(config: ExpoConfigLike, expoPlugins: ExpoConfigPlugins | null): ExpoConfigLike {
  let modifiedConfig: ExpoConfigLike = {
    ...config,
    extra: {
      ...config.extra,
      otaEnabled: true,
    },
  };
  if (!expoPlugins) {
    return modifiedConfig;
  }

  const projectRoot = (config._internal as { projectRoot?: string } | undefined)?.projectRoot;
  if (isExpoUpdatesInstalled(projectRoot)) {
    warn(
      expoPlugins,
      'android',
      'expo-updates is installed. It replaces the JS bundle too and can take precedence over Kaze; remove it or set updates.enabled to false.'
    );
  }

  if (typeof expoPlugins.withMainApplication === 'function') {
    modifiedConfig = expoPlugins.withMainApplication(modifiedConfig, (modConfig) => {
      if (modConfig.modResults?.contents) {
        modConfig.modResults.contents = modifyMainApplication(modConfig.modResults.contents);
        if (!hasAndroidLoader(modConfig.modResults.contents)) {
          warn(expoPlugins, 'android', `MainApplication ${NOT_PATCHED}`);
        }
      }
      return modConfig;
    });
  }
  if (typeof expoPlugins.withAppDelegate === 'function') {
    modifiedConfig = expoPlugins.withAppDelegate(modifiedConfig, (modConfig) => {
      if (modConfig.modResults?.contents) {
        modConfig.modResults.contents = modifyAppDelegate(modConfig.modResults.contents);
        if (!hasIOSLoader(modConfig.modResults.contents)) {
          warn(expoPlugins, 'ios', `AppDelegate ${NOT_PATCHED}`);
        }
      }
      return modConfig;
    });
  }

  return modifiedConfig;
}

const withOTA: ConfigPlugin = (config) => {
  let expoPlugins: ExpoConfigPlugins | null = null;
  try {
    expoPlugins = require('@expo/config-plugins');
  } catch {
    // @expo/config-plugins not installed; fallback config returned
  }
  return applyOTAPlugin(config, expoPlugins);
};

export default withOTA;
