/**
 * Metro, taught two things it can't work out on its own in this repo.
 *
 * 1. Monorepo roots. Metro only watches the app directory by default, so an
 *    edit in packages/client wouldn't reach the running app — and the shared
 *    packages' own dependencies wouldn't resolve at all.
 * 2. NativeWind's CSS entry, which is what compiles the Tailwind utilities the
 *    components use.
 */
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// Resolve from the app outwards, so the app's pinned React (19, for RN) always
// wins over the web app's (18) rather than whichever is found first.
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: "./src/global.css" });
