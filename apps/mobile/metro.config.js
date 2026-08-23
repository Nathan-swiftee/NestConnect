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

// Nothing here needs to teach Metro how to reach the shared packages' source.
// @ding/schemas and @ding/client each expose `./src/index.ts` under a
// `react-native` key — both as an exports condition and as a top-level main
// field — and Expo's defaults already ask for exactly that: resolverMainFields
// is ["react-native", "browser", "main"], and unstable_conditionsByPlatform
// puts "react-native" in the condition set for android and ios. So the native
// build compiles those packages from TypeScript and never looks at dist/.
//
// That matters because dist/ is a build artefact and is gitignored: on EAS the
// checkout has no dist/ when Metro runs. The web and API builds are unaffected
// — neither asks for the react-native condition, so both still get dist/.
//
// Two independent paths reach the source (the exports condition, and the main
// field if unstable_enablePackageExports is ever turned off), so don't add an
// unstable_conditionNames override here: setting it wrong is a quiet way to
// break the one that currently works.

module.exports = withNativeWind(config, { input: "./src/global.css" });
