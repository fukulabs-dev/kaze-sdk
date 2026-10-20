// Wires a freshly generated React Native app to the installed @fukulabs/kaze-sdk the way users do:
// the native entry points are patched with the plugin code that ships in the package, so CI also
// fails when a new React Native template stops matching what the plugin knows how to patch.
//
// Usage: node scripts/ci/wire-test-app.mjs <app-dir> <android|ios>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const [appDirArg, platform] = process.argv.slice(2);
const appDir = appDirArg && resolve(appDirArg);
if (!appDir || !['android', 'ios'].includes(platform)) {
  console.error('Usage: node wire-test-app.mjs <app-dir> <android|ios>');
  process.exit(1);
}

const requireFromApp = createRequire(join(appDir, 'package.json'));
const { modifyMainApplication, modifyAppDelegate } = requireFromApp('@fukulabs/kaze-sdk/plugin');

function findFiles(dir, predicate) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

function patch(file, transform) {
  const before = readFileSync(file, 'utf8');
  const after = transform(before);
  if (!after.includes('KazeBundleLoader.getJSBundleFile')) {
    console.error(`Plugin did not inject the OTA loader into ${file}. Current template:\n\n${before}`);
    process.exit(1);
  }
  writeFileSync(file, after);
  console.log(`Patched ${file}:\n\n${after}\n`);
}

if (platform === 'android') {
  const [mainApplication] = findFiles(join(appDir, 'android', 'app', 'src', 'main'), (n) => n === 'MainApplication.kt');
  if (!mainApplication) {
    console.error('MainApplication.kt not found');
    process.exit(1);
  }
  patch(mainApplication, modifyMainApplication);
} else {
  const iosDir = join(appDir, 'ios');
  const candidates = findFiles(iosDir, (n) => n === 'SceneDelegate.swift' || n === 'AppDelegate.swift')
    .filter((file) => !file.includes(`${join('ios', 'Pods')}`))
    .filter((file) => /func (bundleURL|sourceURL)\(/.test(readFileSync(file, 'utf8')));
  if (candidates.length === 0) {
    console.error('No AppDelegate.swift / SceneDelegate.swift with bundleURL() or sourceURL(for:) found');
    process.exit(1);
  }
  patch(candidates[0], modifyAppDelegate);
}

// Pull the JS API into the release bundle so Metro has to resolve and bundle the package.
const indexFile = join(appDir, 'index.js');
const index = readFileSync(indexFile, 'utf8');
if (!index.includes('@fukulabs/kaze-sdk')) {
  writeFileSync(
    indexFile,
    `import { initBootGuard, useOTA } from '@fukulabs/kaze-sdk';\n\ninitBootGuard();\nvoid useOTA;\n\n${index}`
  );
}
