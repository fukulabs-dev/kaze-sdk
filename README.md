# @fukulabs/kaze

React Native Client SDK for **Kaze (風)**, the open-source Over-The-Air update platform by [fukulabs.dev](https://fukulabs.dev).

Supports Android and iOS on both Bare React Native and Expo.

---

## Features

- **Silent Background Updates**: Checks for updates and stages new JS bundles in the background, applying them on the next app launch without blocking the user.
- **Pure Cryptographic Integrity**: Verifies full bundle SHA-256 checksums before unpacking to ensure corrupt or truncated archives are rejected.
- **5-Second Crash Guard**: Automatically intercepts crashes within 5 seconds of booting a new bundle, blacklists the faulty release hash, and rolls back to the prior stable bundle or built-in binary asset.
- **Zero-Boilerplate React Hook**: Track update status, progress percentage, and manual triggers via `useOTA()`.
- **Expo Config Plugin**: Zero manual native code modifications on Expo with `withOTA`.

---

## Installation

```bash
npm install @fukulabs/kaze
# or
yarn add @fukulabs/kaze
# or
pnpm add @fukulabs/kaze
```

---

## Setup

### 1. Expo (Managed & Prebuild)

Add the Kaze plugin to your `app.json`:

```json
{
  "expo": {
    "plugins": ["@fukulabs/kaze/plugin"]
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

In your `MainApplication.kt` (or `MainApplication.java`), override `getJSBundleFile()` on `ReactNativeHost`:

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

In your `AppDelegate.swift` (or `AppDelegate.mm`), point bundle loading to `OtaBundleLoader`:

```swift
import OtaModule

override func sourceURL(for bridge: RCTBridge!) -> URL! {
    if let otaUrl = OtaBundleLoader.getJSBundleFile() {
        return otaUrl
    }
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
}
```

---

## Usage in React Native

Use the `useOTA` hook in your root component:

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { useOTA } from '@fukulabs/kaze';

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
| `autoApply` | `'next-restart' \| 'immediate'` | No | `'next-restart'` | When to apply the downloaded bundle. |
| `autoCheck` | `boolean` | No | `true` | Automatically checks for updates on mount. |
| `checkOnResume` | `boolean` | No | `false` | Automatically checks for updates when app returns from background to foreground. |
| `reportStatus` | `boolean` | No | `true` | Automatically reports staging and failure telemetry to the Kaze server. |
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
| `applyUpdate` | `() => Promise<void>` | Apply staged bundle immediately by restarting the app. |
| `downloadAndStage` | `(manifest?) => Promise<boolean>` | Manually download and stage bundle package. |

---

## 5-Second Boot Crash Guard

Initialize `initBootGuard` at your app entrypoint (e.g. `index.js`) to protect against faulty bundle releases:

```typescript
import { initBootGuard } from '@fukulabs/kaze';

// Monitors startup for 5s; blacklists hash and reverts if app crashes.
// Uses zero-dependency native persistent storage by default.
initBootGuard({
  stabilityTimeoutMs: 5000,
  onCrashRollback: (badHash, reason) => {
    console.warn(`Rolled back bad bundle ${badHash}: ${reason}`);
  },
});
```
---

## Security & Verification

1. **Checksum Validation**: The SDK computes pure SHA-256 hashes on the raw downloaded bytes before any filesystem extraction. If the hash does not match the server release manifest, the archive is discarded.
2. **Path Traversal Protection**: Staged archive unzipping validates entry paths to prevent relative path injection (`../`).
3. **Crash Watchdog**: If an unhandled fatal JS exception occurs within 5 seconds of launch, native storage flags the hash as failed, preventing boot loops.

---

## License

MIT © [fukulabs.dev](https://fukulabs.dev)
