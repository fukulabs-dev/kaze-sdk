# Changelog

## [0.1.0-beta.3](https://github.com/fukulabs-dev/kaze-sdk/compare/v0.1.0-beta.2...v0.1.0-beta.3) (2026-10-23)


### ⚠ BREAKING CHANGES

* bundleUrl must serve a zip archive with the entry bundle and all assets at the root; single JS files are rejected.

### Features

* add request timeouts and download retries ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* **plugin:** warn when native files cannot be patched or expo-updates is installed ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* report rolled_back and active outcomes to the server ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* roll back bundles that die before the boot guard can confirm them ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))


### Bug Fixes

* **android:** store bundles in noBackupFilesDir, outside the Auto Backup quota ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* **android:** take Gradle plugin and react-android versions from the host app ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* clear a stale boot guard testing marker when nothing is guarded ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* do not download a bundle this device already rolled back ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* **ios:** store bundles in Application Support, excluded from iCloud backup ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* keep status downloading while another check runs ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* require zip bundle archives ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))
* set peer dependency ranges to react-native &gt;=0.76 and react &gt;=18.2 ([bd6cb4c](https://github.com/fukulabs-dev/kaze-sdk/commit/bd6cb4c978f679ba5a37091c54f284b34c2f8677))

## [0.1.0-beta.2](https://github.com/fukulabs-dev/kaze-sdk/compare/v0.1.0-beta.1...v0.1.0-beta.2) (2026-10-20)


### ⚠ BREAKING CHANGES

* bare apps must import dev.fukulabs.kaze.KazeBundleLoader and use KazeBundleLoader instead of com.otarn.OtaBundleLoader / OtaBundleLoader. Expo apps pick this up on prebuild. Staged updates on devices are kept.

### Features

* rename native package to dev.fukulabs.kaze and Ota* classes to Kaze* ([0ae9123](https://github.com/fukulabs-dev/kaze-sdk/commit/0ae912383c9cf51c8350f7d33d666280cf3e6c7c))

## [0.1.0-beta.1](https://github.com/fukulabs-dev/kaze-sdk/compare/v0.1.0-beta.0...v0.1.0-beta.1) (2026-10-20)


### Features

* beta.1 update-loop fixes, RN 0.88 iOS support, native build CI, release-please ([56150e0](https://github.com/fukulabs-dev/kaze-sdk/commit/56150e0606c070326d981062d71e7aa7376cab1b))


### Bug Fixes

* **ios:** avoid overlapping access in raw deflate decompression ([ccbb66c](https://github.com/fukulabs-dev/kaze-sdk/commit/ccbb66c6f6e0b6968a00e1ead3b1a5aa7ae66c36))


### Documentation

* add Kaze logo and show it in README ([5bb67b2](https://github.com/fukulabs-dev/kaze-sdk/commit/5bb67b29dd0a366eedf31099f699ca817c8ab867))
