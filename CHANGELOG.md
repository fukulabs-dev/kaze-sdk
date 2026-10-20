# Changelog

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
