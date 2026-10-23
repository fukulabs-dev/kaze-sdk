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
>
> Upgrading from `0.1.0-beta.1` or earlier: the native classes were renamed. In bare apps, change `import com.otarn.OtaBundleLoader` to `import dev.fukulabs.kaze.KazeBundleLoader` and `OtaBundleLoader` to `KazeBundleLoader` (Kotlin and Swift). Expo apps get this from `npx expo prebuild`. Staged updates on users' devices are kept.

---

## Features

- **Background updates**: checks for updates, downloads and stages new JS bundles without blocking the user, and activates them on the next cold launch (or right away if you choose).
- **Integrity check**: every download is verified against the SHA-256 hash in the release manifest before it is unpacked, so corrupt or truncated archives are rejected.
- **Crash guard**: if a new bundle hits a fatal JS error within 5 seconds of its first launch, or keeps dying before it can start (native crash, out-of-memory kill), it is blacklisted, the next launch falls back to the previous bundle or the one built into the app, and the rollback is reported to the server. A rolled-back bundle is never downloaded again on that device.
- **Safe staging**: updates are written to an inactive slot and only marked complete once every file is on disk, so an interrupted download never boots a half-written bundle.
- **Store-update aware**: when users install a new app version from the App Store or Play Store, old OTA bundles are discarded automatically.
- **React hook**: `useOTA()` exposes status, progress, and manual controls.
- **Expo config plugin**: no manual native changes on Expo.

---

## Requirements

- React Native 0.76 or newer with the New Architecture. CI builds every change against React Native 0.88 on Android and iOS; older versions are not tested yet.
- iOS 13.4+, Android minSdk 24+.
- Expo: development builds or `npx expo prebuild`. Expo Go cannot load the SDK's native module.
- A Kaze server (or any server implementing the [Server API](#server-api) below).

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

If the plugin cannot find where to load the OTA bundle in `MainApplication` or `AppDelegate`, prebuild prints a warning. Without the loader, updates download but never run, so add it by hand as in the bare setup below. Don't use Kaze together with `expo-updates`: both replace the JS bundle, and the plugin warns when `expo-updates` is installed.

---

### 2. Bare React Native

#### Android Setup

In your `MainApplication.kt`, pass the OTA bundle to `getDefaultReactHost` (React Native 0.80+ template):

```kotlin
import dev.fukulabs.kaze.KazeBundleLoader

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList = PackageList(this).packages,
      // null falls back to the bundle embedded in the APK
      jsBundleFilePath = KazeBundleLoader.getJSBundleFile(applicationContext),
    )
  }
  // ...
}
```

If your `MainApplication` still defines a `ReactNativeHost` (older templates, Expo), override `getJSBundleFile()` there instead:

```kotlin
import dev.fukulabs.kaze.KazeBundleLoader

class MainApplication : Application(), ReactApplication {
  override val reactNativeHost: ReactNativeHost =
    object : DefaultReactNativeHost(this) {
      override fun getJSBundleFile(): String? {
        return KazeBundleLoader.getJSBundleFile(applicationContext) ?: super.getJSBundleFile()
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
  if let otaUrl = KazeBundleLoader.getJSBundleFile() {
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

Then run `pod install` in the `ios` folder.

> OTA bundles are only loaded in release builds. Debug builds (and debuggable Android builds) always use Metro or the embedded bundle, so test updates with a release build.

---

## Usage in React Native

Use the `useOTA` hook in your root component:

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { useOTA } from '@fukulabs/kaze-sdk';

export default function App() {
  const { status, progress, error, applyUpdate } = useOTA({
    appId: 'my-app',
    serverUrl: 'https://kaze.yourcompany.com',
    runtimeVersion: '1.0.0',
    channel: 'production',
    autoApply: 'next-restart', // Background download, activates on next cold launch
    checkOnResume: true,
    onUpdateAvailable: (manifest) => console.log('Update found:', manifest.id),
    onError: (err) => console.error('OTA error:', err),
  });

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Update status: {status}</Text>
      {status === 'downloading' && <Text>Downloading update: {progress}%</Text>}
      {status === 'ready' && <Text onPress={applyUpdate}>Update ready! Tap to restart now.</Text>}
      {status === 'error' && <Text>Update failed: {error?.message}</Text>}
    </View>
  );
}
```

Outside React, `createOTAController(options)` takes the same options and returns the same methods plus `getState()` and `subscribe(listener)`.

### Options

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `appId` | `string` | **Yes** | - | Application identifier registered on the Kaze server. |
| `serverUrl` | `string` | **Yes** | - | Base URL of your Kaze server. |
| `runtimeVersion` | `string` | **Yes** | - | Version of the native binary. Only bundles built for exactly this runtime version are accepted; change it whenever native code changes. |
| `channel` | `string` | No | `'production'` | Target distribution channel (e.g. `staging`, `production`). |
| `platform` | `'android' \| 'ios'` | No | `Platform.OS` | Mobile target platform. |
| `autoApply` | `'next-restart' \| 'immediate' \| 'manual'` | No | `'next-restart'` | `'next-restart'` downloads and stages in the background for the next cold launch; `'immediate'` also restarts the app once staged; `'manual'` only checks, so you call `downloadAndStage()` yourself. |
| `autoCheck` | `boolean` | No | `true` | Check for updates on mount. |
| `checkOnResume` | `boolean` | No | `false` | Check for updates when the app returns to the foreground. An update that is already staged is not downloaded again. |
| `reportStatus` | `boolean` | No | `true` | Report `staged`, `failed`, `active`, and `rolled_back` events to the Kaze server. |
| `requestTimeoutMs` | `number` | No | `15000` | Timeout for update checks and status reports. `0` disables it. |
| `downloadTimeoutMs` | `number` | No | `120000` | Timeout for one bundle download attempt. `0` disables it. |
| `downloadRetries` | `number` | No | `2` | Extra download attempts after a network error, timeout, or a 5xx, 408, or 429 response, waiting 1 s, then 2 s, and so on. Other 4xx responses and checksum mismatches are not retried. |
| `currentHash` | `string` | No | Running OTA bundle | Hash of the bundle the app is running, sent to the server. Detected from the native loader when omitted. |
| `deviceId` | `string` | No | - | Device identifier sent with checks and reports. |
| `clientUuid` | `string` | No | - | Persistent client UUID for targeted rollout tracking. |
| `fileSystem` | `FileSystemAdapter` | No | `NativeFileSystemAdapter` | Pluggable filesystem adapter (defaults to native disk staging). |
| `onUpdateAvailable` | `(manifest) => void` | No | - | Called when a new release is found. |
| `onDownloadProgress` | `(progress) => void` | No | - | Called with download progress (0-100). |
| `onUpdateStaged` | `(manifest) => void` | No | - | Called once the bundle is verified and staged. |
| `onError` | `(error) => void` | No | - | Called on network, validation, checksum, or staging failure. |

### Return Values

| Property | Type | Description |
|---|---|---|
| `status` | `'idle' \| 'checking' \| 'downloading' \| 'ready' \| 'error'` | Current state. `ready` means an update is staged and will load on the next launch. |
| `isChecking` | `boolean` | A check request is in flight. |
| `isDownloading` | `boolean` | A download or staging is in progress. |
| `progress` | `number` | Download progress (0 to 100). |
| `updateAvailable` | `boolean` | The server offered an update for this app, platform, runtime version, and channel. |
| `manifest` | `ReleaseManifest \| null` | Release metadata of the offered update. |
| `error` | `Error \| null` | Error from the last check, download, or verification. |
| `checkForUpdate` / `check` | `() => Promise<ReleaseManifest \| null>` | Check for an update now. |
| `downloadAndStage` | `(manifest?) => Promise<boolean>` | Download, verify, and stage an update. Calling it again for the same bundle while it runs waits for the first call. |
| `applyUpdate` | `() => Promise<void>` | Apply the staged bundle now. iOS reloads the JS in place; Android restarts the app process. |

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
5. `useOTA` reports the outcome on its next check (on mount, or on resume with `checkOnResume`): `rolled_back` for the blacklisted bundle, `active` for a bundle that was marked stable. Each is sent once per device; a report that fails is retried on the following check. If the server offers a bundle this device rolled back, it is ignored.

Bundles that die before the guard can see the error (a native crash, an out-of-memory kill, or an error thrown before `initBootGuard` runs) are caught by the native loader instead. Once `initBootGuard` has run, the loader counts every launch of an OTA bundle that has not been marked stable yet. After two such launches in a row, the next launch blacklists the bundle and boots the previous one, so users see at most two crashes. Two are allowed so that a user who closes the app inside the stability window once does not roll back a good bundle.

Limits: a crash after the stability window is not treated as a bad bundle. Because native rollback depends on the guard marking bundles stable, keep `initBootGuard` in every bundle you ship: a bundle without it is rolled back after two launches.

To guard a specific hash yourself, pass `activeHash`; pass `activeHash: null` to turn the automatic check off. That also turns off the native rollback described above.

---

## How Updates Are Applied

1. **Check**: the SDK asks the server for an update, sending the app ID, platform, runtime version, channel, and the hash of the running bundle. The response is validated, and a manifest for a different platform or runtime version is rejected.
2. **Download and verify**: the bundle is downloaded and its SHA-256 hash is compared with the manifest before anything is written to disk.
3. **Stage**: files are written to whichever of two slots (`slot_a`, `slot_b`) the app is not running from. `bundle.hash` is written last; until it exists, the native loader ignores the slot. Slots live in `Library/Application Support/kaze/ota` on iOS (excluded from iCloud backup) and in `noBackupFilesDir/ota` on Android (excluded from Auto Backup). Bundles staged by 0.1.0-beta.2 or earlier, in `Documents/ota` or `filesDir/ota`, are moved there on the first launch.
4. **Activate**: on the next cold launch (or immediately with `applyUpdate()`), the native loader boots the newest complete, non-blacklisted slot, falls back to the other slot, and finally to the bundle built into the app.

### App Store / Play Store updates

Staged bundles are tied to the native binary that downloaded them. When the app's version, build number, or (on Android) install time changes, the native loader deletes every staged bundle on the next launch and boots the bundle embedded in the new binary.

---

## Server API

The SDK talks to two endpoints under `serverUrl`. The Kaze server implements them; any server that does can be used instead.

### `GET /api/v1/updates/check`

Query parameters: `appId`, `platform` (`android` or `ios`), `runtimeVersion`, `channel`, and optionally `currentHash`, `deviceId`, `clientUuid`.

```json
{
  "updateAvailable": true,
  "manifest": {
    "id": "rel_42",
    "appId": "my-app",
    "platform": "android",
    "runtimeVersion": "1.0.0",
    "channel": "production",
    "bundleHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "bundleUrl": "https://cdn.example.com/bundles/rel_42.zip",
    "bundleSize": 1048576,
    "isMandatory": false,
    "rolloutPercentage": 100,
    "createdAt": "2026-10-20T10:00:00Z"
  }
}
```

| Field | Notes |
|---|---|
| `bundleHash` | SHA-256 (hex) of the exact file served at `bundleUrl`. |
| `bundleUrl` | Absolute URL, or a path resolved against `serverUrl`. |
| `platform`, `runtimeVersion` | Must match the client's values or the update is rejected. |
| `channel`, `isMandatory`, `rolloutPercentage` | Optional, default to `production`, `false`, `100`. Rollout and mandatory decisions are made by the server; the SDK does not act on these fields. |
| `createdAt` | ISO 8601 timestamp; a timezone offset is allowed. |

Respond with `{ "updateAvailable": false }` when there is nothing new, including when `currentHash` is already the latest bundle.

### `POST /api/v1/updates/report`

JSON body with `appId`, `releaseId`, `status`, and optionally `platform`, `runtimeVersion`, `bundleHash`, `deviceId`, `clientUuid`, `reason`, `error`. Respond with `{ "success": true }`.

| `status` | Sent when |
|---|---|
| `staged` | The bundle was downloaded, verified, and staged for the next launch. |
| `failed` | Download, verification, or staging failed. `reason` has the error. |
| `active` | The bundle booted and passed the boot guard window. |
| `rolled_back` | The bundle hit a fatal error in the boot guard window and the device went back to the previous bundle. Pause the rollout when these come in. |

### Bundle archive

`bundleUrl` serves a zip archive (stored or deflate) with:

- the entry bundle at the root: `index.android.bundle` on Android, `main.jsbundle` on iOS;
- **all** of the app's assets next to it, in the layout `react-native bundle --assets-dest` produces (`drawable-*` folders on Android, `assets/` on iOS), not only the ones that changed;
- no absolute paths or `..` segments (such archives are rejected).

A bare JS file is rejected with an error and reported as `failed`. React Native loads every bundled image from next to the bundle file it booted, so a bundle without its assets would show none of the app's images.

For example, for Android:

```bash
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output ota/index.android.bundle --assets-dest ota
(cd ota && zip -r ../android.zip .)
shasum -a 256 android.zip   # bundleHash
```

---

## Security

1. **Integrity**: the SHA-256 of every download is checked against the manifest before extraction; on mismatch the download is discarded.
2. **Response validation**: check responses are schema-validated, and bundles for another platform or runtime version are refused.
3. **Path traversal protection**: archive entries with absolute paths or `..` are rejected, both in JS and in the native file APIs.
4. **Crash guard**: see [above](#5-second-boot-crash-guard).

Not yet supported: **code signing**. The hash proves the download is intact, not who published it, so anyone who controls your Kaze server can ship code to your users. Serve `serverUrl` and `bundleUrl` over HTTPS and restrict who can publish releases. Signed manifests are planned before 1.0.

---

## License

MIT © [fukulabs.dev](https://fukulabs.dev)
