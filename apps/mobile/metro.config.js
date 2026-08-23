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

/**
 * The shared workspace packages, resolved straight to their TypeScript source.
 *
 * @ding/schemas and @ding/client build a `dist/` for the web and API. That
 * `dist/` is a build artefact and is gitignored, so a fresh checkout doesn't
 * have one — and a fresh checkout is exactly what EAS bundles. Metro reaching
 * for `dist/` there fails with "specifies a main module field that could not be
 * resolved", which reads like a broken package rather than a missing build.
 *
 * The packages also advertise their source under a `react-native` key, as both
 * an exports condition and a main field, and Expo does ask for that condition
 * on native. So this alias is not the only path to the source — it is the only
 * path that can't drift. Conditions resolve through several layers (exports
 * map, main fields, `unstable_conditionsByPlatform`, package-exports being
 * enabled), each with its own defaults, and any layer disagreeing produces that
 * same misleading `dist/` error. An alias has one layer. After three remote
 * builds spent reading that error, one layer is worth the fifteen lines.
 *
 * @ding/design is deliberately absent: it has no build step, its exports point
 * at source already, so it has nothing to drift.
 */
const SOURCE_PACKAGES = {
  "@ding/client": path.resolve(workspaceRoot, "packages/client/src/index.ts"),
  "@ding/schemas": path.resolve(workspaceRoot, "packages/schemas/src/index.ts"),
};

// After withNativeWind, not before: it installs a resolver of its own, and
// wrapping the composed config is what guarantees this one runs first rather
// than being overwritten by it.
const metroConfig = withNativeWind(config, { input: "./src/global.css" });

const upstreamResolve = metroConfig.resolver.resolveRequest;
metroConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  const source = SOURCE_PACKAGES[moduleName];
  if (source) return { type: "sourceFile", filePath: source };
  // Metro passes the next resolver in the chain as context.resolveRequest, so
  // this delegates rather than recursing.
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = metroConfig;
