<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/kaze-logo-dark.svg">
    <img src="assets/logo/kaze-logo-light.svg" alt="Kaze" width="280">
  </picture>
</p>

# @fukulabs/kaze-sdk

React Native Client SDK for **Kaze (風)**, the open-source Over-The-Air update platform by [fukulabs.dev](https://fukulabs.dev).

Supports Android and iOS on both Bare React Native and Expo.

> Formerly published as `@fukulabs/kaze`. If you used it, switch the dependency and imports to `@fukulabs/kaze-sdk`, change the Expo plugin entry to `@fukulabs/kaze-sdk/plugin`, run `pod install` again, and replace any Swift `import` of the old module with `import kaze_sdk`.

---

## Features

- **Silent Background Updates**: Checks for updates and stages new JS bundles in the background, applying them on the next app launch without blocking the user.
- **Pure Cryptographic Integrity**: Verifies full bundle SHA-256 checksums before unpacking to ensure corrupt or truncated archives are rejected.
- **5-Second Crash Guard**: Catches fatal JS errors within 5 seconds of the first boot of a new bundle, blacklists the faulty release hash, and rolls back to the prior stable bundle or built-in binary asset.
- **Zero-Boilerplate React Hook**: Track update status, progress percentage, and manual triggers via `useOTA()`.
- **Expo Config Plugin**: Zero manual native code modifications on Expo with `withOTA`.

---

## Installation

```bash
npm install @fukulabs/kaze-sdk@beta
# or
yarn add @fukulabs/kaze-sdk@beta
# or
pnpm add @fukulabs/kaze-sdk@beta
```

Kaze is in beta: releases are published under the `beta` dist-tag until the first stable version.

---

## Setup

### 1. Expo (Managed & Prebuild)

Add the Kaze plugin to your `app.json`:

```json
{
  "expo": {
    "plugins": ["@fukulabs/kaze-sdk/plugin"]
  }
}
```

Then regenerate native build folders:

```bash
npx expo prebuild
```

---

### 2. Bare React Native

#### Android Setup

In your `MainApplication.kt`, pass the OTA bundle to `getDefaultReactHost` (React Native 0.80+ template):

```kotlin
import com.otarn.OtaBundleLoader

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList = PackageList(this).packages,
      // null falls back to the bundle embedded in the APK
      jsBundleFilePath = OtaBundleLoader.getJSBundleFile(applicationContext),
    )
  }
  // ...
}
```

If your `MainApplication` still defines a `ReactNativeHost` (older templates, Expo), override `getJSBundleFile()` there instead:

```kotlin
import com.otarn.OtaBundleLoader

class MainApplication : Application(), ReactApplication {
  override val reactNativeHost: ReactNativeHost =
    object : DefaultReactNativeHost(this) {
      override fun getJSBundleFile(): String? {
        return OtaBundleLoader.getJSBundleFile(applicationContext) ?: super.getJSBundleFile()
      }
      // ...
    }
}
```

#### iOS Setup

Find `override func bundleURL() -> URL?`. In the React Native 0.80+ template it is in `SceneDelegate.swift`; in older templates and Expo it is in `AppDelegate.swift`. Rename the existing function to a helper and add an override that tries the OTA bundle first:

```swift
import kaze_sdk

override func bundleURL() -> URL? {
#if !DEBUG
  if let otaUrl = OtaBundleLoader.getJSBundleFile() {
    return otaUrl
  }
#endif
  return kazeEmbeddedBundleURL()
}

// Your original bundleURL() body, unchanged.
func kazeEmbeddedBundleURL() -> URL? {
  #if DEBUG
  RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
  #else
  Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  #endif
}
```

Older apps that implement `sourceURL(for bridge:)` instead follow the same pattern with that method. The Expo plugin applies this change for you.

> OTA bundles are only loaded in release builds. Debug builds (and debuggable Android builds) always use Metro or the embedded bundle, so test updates with a release build.

---

## Usage in React Native

Use the `useOTA` hook in your root component:

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { useOTA } from '@fukulabs/kaze-sdk';

export default function App() {
  const {
    status,
    progress,
    updateAvailable,
    manifest,
    error,
    checkForUpdate,
    applyUpdate,
  } = useOTA({
    appId: 'my-app',
    serverUrl: 'https://kaze.yourcompany.com',
    runtimeVersion: '1.0.0',
    channel: 'production',
    autoApply: 'next-restart', // Background download, activates on next cold launch
    onUpdateAvailable: (manifest) => console.log('Update found:', manifest.id),
    onDownloadProgress: (progress) => console.log(`Downloaded ${progress}%`),
    onUpdateStaged: () => console.log('Bundle staged and ready'),
    onError: (err) => console.error('OTA error:', err),
  });

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Application Status: {status}</Text>
      {status === 'downloading' && <Text>Downloading update: {progress}%</Text>}
      {status === 'ready' && (
        <Text onPress={applyUpdate}>Update ready! Tap to restart now.</Text>
      )}
    </View>
  );
}
```

### Options

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `appId` | `string` | **Yes** | - | Application identifier registered on the Kaze server. |
| `serverUrl` | `string` | **Yes** | - | Base URL of your self-hosted Kaze server. |
| `runtimeVersion` | `string` | **Yes** | - | Native binary version string (e.g. `1.0.0`). |
| `channel` | `string` | No | `'production'` | Target distribution channel (e.g. `staging`, `production`). |
| `platform` | `'android' \| 'ios'` | No | Auto-detected | Mobile target platform (`Platform.OS` fallback). |
| `autoApply` | `'next-restart' \| 'immediate' \| 'manual'` | No | `'next-restart'` | `'next-restart'` downloads and stages in the background for the next cold launch; `'immediate'` also restarts the app once staged; `'manual'` only checks, so you call `downloadAndStage()` yourself. |
| `autoCheck` | `boolean` | No | `true` | Automatically checks for updates on mount. |
| `checkOnResume` | `boolean` | No | `false` | Automatically checks for updates when app returns from background to foreground. |
| `reportStatus` | `boolean` | No | `true` | Automatically reports staging and failure telemetry to the Kaze server. |
| `currentHash` | `string` | No | Running OTA bundle | Hash of the bundle the app is running, sent to the server. Detected from the native loader when omitted. |
| `clientUuid` | `string` | No | - | Optional persistent client UUID for targeted rollout tracking. |
| `fileSystem` | `FileSystemAdapter` | No | `NativeFileSystemAdapter` | Pluggable filesystem adapter (defaults to zero-dependency native disk staging). |
| `onUpdateAvailable` | `(manifest) => void` | No | - | Callback invoked when a new bundle release is discovered. |
| `onDownloadProgress` | `(progress) => void` | No | - | Invoked with download progress percentage (0-100). |
| `onUpdateStaged` | `(manifest) => void` | No | - | Callback invoked when bundle is extracted and staged. |
| `onError` | `(error) => void` | No | - | Callback invoked on network, checksum, or staging failure. |

### Return Values

| Property | Type | Description |
|---|---|---|
| `status` | `'idle' \| 'checking' \| 'downloading' \| 'ready' \| 'error'` | Current update state machine status. |
| `progress` | `number` | Download progress percentage (0 to 100). |
| `updateAvailable` | `boolean` | Whether an update is available on the distribution server. |
| `manifest` | `ReleaseManifest \| null` | Server release metadata for the available update. |
| `error` | `Error \| null` | Error object if check, download, or verification failed. |
| `checkForUpdate` | `() => Promise<ReleaseManifest \| null>` | Trigger manual update check. |
| `applyUpdate` | `() => Promise<void>` | Apply the staged bundle now. iOS reloads the JS in place; Android restarts the app process. |
| `downloadAndStage` | `(manifest?) => Promise<boolean>` | Manually download and stage bundle package. |

---

## 5-Second Boot Crash Guard

Call `initBootGuard` at the very top of your app entrypoint (e.g. `index.js`), before `AppRegistry.registerComponent`, so it is in place before any of your app code runs:

```typescript
import { initBootGuard } from '@fukulabs/kaze-sdk';

initBootGuard({
  stabilityTimeoutMs: 5000,
  onCrashRollback: (badHash, reason) => {
    console.warn(`Rolled back bad bundle ${badHash}: ${reason}`);
  },
});
```

How it works:

1. On launch, the guard asks the native loader which OTA bundle it booted. If that bundle has not yet been marked stable, the guard starts a stability window (`stabilityTimeoutMs`, default 5000 ms). When the app is running the embedded bundle, or a bundle that already passed this check, nothing is guarded.
2. If a fatal JS error reaches React Native's global error handler inside the window, the bundle's hash is blacklisted synchronously in native storage, then the error is passed on to the previous handler, which normally crashes the app.
3. On the next launch the native loader skips the blacklisted bundle and boots the previous slot, or the embedded bundle if there is none.
4. If the window passes without a fatal error, the bundle is marked stable and is not guarded again.

Limits: the guard only catches fatal JS errors that reach `ErrorUtils`. Native crashes, out-of-memory kills, and bundles that fail before `initBootGuard` runs (for example a syntax error in the bundle itself) are not caught.

To guard a specific hash yourself, pass `activeHash`; pass `activeHash: null` to turn the automatic check off.

### App Store / Play Store updates

Staged bundles are tied to the native binary that downloaded them. When the app's version, build number, or (on Android) install time changes, the native loader deletes every staged bundle on the next launch and boots the bundle embedded in the new binary.
---

## Security & Verification

1. **Checksum Validation**: The SDK computes pure SHA-256 hashes on the raw downloaded bytes before any filesystem extraction. If the hash does not match the server release manifest, the archive is discarded.
2. **Path Traversal Protection**: Staged archive unzipping validates entry paths to prevent relative path injection (`../`).
3. **Crash Watchdog**: If an unhandled fatal JS exception occurs within 5 seconds of the first launch of a new bundle, native storage flags the hash as failed and the next launch falls back to the previous bundle. See the limits above.

---

## License

MIT © [fukulabs.dev](https://fukulabs.dev)
