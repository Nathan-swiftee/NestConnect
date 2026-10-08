import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BUILD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public releases deliberately cannot piggyback on iOS/all, preview, or OTA.
export function submissionProfile({ mode, platform, profile, submit, androidRelease = 'internal-draft', buildId }) {
  if (!['internal-draft', 'public-production'].includes(androidRelease)) {
    throw new Error('Unknown Android release target');
  }
  if (androidRelease === 'public-production' && (
    platform !== 'android' || profile !== 'production' ||
    !(mode === 'submit' || (mode === 'build' && submit === 'true'))
  )) throw new Error('Public Play release requires Android, production, and submit or build with submit enabled');
  if (mode === 'submit' && platform !== 'ios') {
    if (profile !== 'production') throw new Error('Android submission requires the production build profile');
    if (!BUILD_ID.test(buildId ?? '')) throw new Error('Android submit requires an explicit UUID build ID');
  }
  return androidRelease === 'public-production' ? 'play-production' : 'production';
}

export function validateAndroidBuild(build, id, app) {
  if (build?.id !== id || build?.platform !== 'ANDROID' || build?.status !== 'FINISHED' ||
      build?.buildProfile !== 'production' || build?.distribution !== 'STORE' ||
      build?.app?.id !== app.extra.eas.projectId || build?.appIdentifier !== app.android.package) {
    throw new Error('Build must be a finished Android production/store build for this EAS project and package');
  }
  const archive = new URL(build.artifacts?.applicationArchiveUrl ?? '');
  if (archive.protocol !== 'https:' || !archive.pathname.endsWith('.aab')) {
    throw new Error('Android store submission requires an HTTPS .aab artifact, not a preview APK');
  }
}

export async function submitAndroid(input, app, runEas) {
  const profile = submissionProfile(input);
  if (input.mode !== 'submit' || !['android', 'all'].includes(input.platform)) {
    throw new Error('submit-android requires Android submit mode');
  }
  const build = JSON.parse(await runEas(['build:view', input.buildId, '--json']));
  validateAndroidBuild(build, input.buildId, app);
  await runEas(['submit', '--platform', 'android', '--profile', profile,
    '--id', input.buildId, '--non-interactive', '--wait']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = { mode: process.env.MOBILE_MODE, platform: process.env.MOBILE_PLATFORM,
      profile: process.env.MOBILE_PROFILE, submit: process.env.MOBILE_SUBMIT,
      androidRelease: process.env.MOBILE_ANDROID_RELEASE, buildId: process.env.MOBILE_ANDROID_BUILD_ID };
    if (process.argv[2] === 'validate') {
      const profile = submissionProfile(input);
      appendFileSync(process.env.GITHUB_OUTPUT, `submit_profile=${profile}\n`);
    } else if (process.argv[2] === 'submit-android') {
      const app = JSON.parse(readFileSync(new URL('../apps/mobile/app.json', import.meta.url))).expo;
      await submitAndroid(input, app, (args) => execFileSync('pnpm', ['exec', 'eas', ...args], {
        encoding: 'utf8', stdio: args[0] === 'build:view' ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      }));
    } else throw new Error('Expected validate or submit-android');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
