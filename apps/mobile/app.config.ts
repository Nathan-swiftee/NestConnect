import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json holds the whole configuration. This file exists for the one part of
 * it that can't be static: Sentry.
 *
 * The Sentry Expo plugin applies a Gradle script that uploads source maps as
 * part of the native build, and that needs a real organisation, project and
 * auth token. Those are credentials, so they belong in the environment rather
 * than the repo — and app.json can't read the environment. Written there, the
 * strings "$SENTRY_ORG" and "$SENTRY_PROJECT" are passed through verbatim and
 * land in android/sentry.properties exactly as typed:
 *
 *     defaults.org=$SENTRY_ORG
 *     defaults.project=$SENTRY_PROJECT
 *
 * A build like that bundles cleanly and then fails inside Gradle, because
 * sentry-cli is being asked to upload to an organisation that doesn't exist
 * with no token to do it. The failure surfaces well after the configuration
 * mistake that caused it, which is what made it expensive to find.
 *
 * So the plugin is added only when the credentials are actually present. With
 * them, they're interpolated for real. Without them, there's no plugin, no
 * sentry.properties and no upload task — nothing to fail. The app behaves the
 * same either way: telemetry.ts already declines to initialise Sentry unless
 * EXPO_PUBLIC_SENTRY_DSN was baked into the bundle, so reporting was never on
 * in a build that lacks these anyway.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;

  const organization = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  if (!organization || !project) return base;

  return {
    ...base,
    plugins: [...(base.plugins ?? []), ["@sentry/react-native/expo", { organization, project }]],
  };
};
