import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
const { parse } = createRequire(import.meta.url)('yaml');

const eas = JSON.parse(readFileSync(new URL('../apps/mobile/eas.json', import.meta.url)));
const workflow = parse(readFileSync(new URL('../.github/workflows/mobile.yml', import.meta.url), 'utf8'));
test('workflow keeps push OTA and requires explicit public target and validated Android ID', () => {
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.equal(inputs.android_release.default, 'internal-draft');
  assert.deepEqual(inputs.android_release.options, ['internal-draft', 'public-production']);
  assert.equal(inputs.android_build_id.type, 'string');
  assert.equal(workflow.env.MOBILE_MODE, "${{ github.event_name == 'push' && 'update' || inputs.mode }}");
  assert.equal(workflow.env.MOBILE_PROFILE, "${{ github.event_name == 'push' && 'preview' || inputs.profile }}");
  assert.match(workflow.env.MOBILE_ANDROID_RELEASE, /github.event_name == 'push' && 'internal-draft'/);
  const steps = workflow.jobs.mobile.steps;
  const guard = steps.findIndex(s => s.id === 'release');
  assert.ok(guard > -1 && guard < steps.findIndex(s => s.name === 'Build'));
  assert.match(steps[guard].run, /mobile-release.mjs validate/);
  assert.match(steps.find(s => s.name === 'Build').run, /--auto-submit-with-profile/);
  assert.match(steps.find(s => s.name === 'Submit Android').run, /mobile-release.mjs submit-android/);
  assert.match(steps.find(s => s.name === 'Submit iOS').run, /--platform ios/);
  assert.match(steps.find(s => s.name === 'Submit iOS').run, /--latest/);
  assert.ok(!steps.some(s => s.uses === 'expo/expo-github-action@v8'));
  assert.equal(workflow.jobs.mobile.env.EXPO_TOKEN, '${{ secrets.EXPO_TOKEN }}');
});
test('public submission is opt-in; default remains an internal draft with unchanged iOS', () => {
  assert.deepEqual(eas.submit.production.android, { track: 'internal', releaseStatus: 'draft' });
  assert.equal(eas.submit.production.ios.ascAppId, '6812062945');
  assert.deepEqual(eas.submit['play-production'], {
    android: { track: 'production', releaseStatus: 'completed', changesNotSentForReview: false },
  });
});

test('only an explicit Android production submission selects the public profile', async () => {
  const { submissionProfile } = await import('./mobile-release.mjs');
  const input = { mode: 'build', platform: 'android', profile: 'production', submit: 'true', androidRelease: 'public-production' };
  assert.equal(submissionProfile(input), 'play-production');
  assert.equal(submissionProfile({ ...input, androidRelease: 'internal-draft' }), 'production');
  for (const change of [
    { platform: 'ios' }, { platform: 'all' }, { profile: 'preview' },
    { mode: 'update' }, { submit: 'false' }, { androidRelease: 'unexpected' },
  ]) assert.throws(() => submissionProfile({ ...input, ...change }));
  const id = '57489e60-f4dc-42cf-b2b3-f8b88779a953';
  assert.equal(submissionProfile({ ...input, mode: 'submit', buildId: id }), 'play-production');
  assert.throws(() => submissionProfile({ ...input, mode: 'submit' }), /build ID/i);
  assert.throws(() => submissionProfile({ ...input, mode: 'submit', buildId: '--latest' }), /build ID/i);
  assert.throws(() => submissionProfile({ ...input, mode: 'submit', buildId: ` ${id}` }), /build ID/i);
  assert.equal(submissionProfile({ mode: 'submit', platform: 'ios', profile: 'production' }), 'production');
});

test('Android submit rejects wrong project, platform, profile, status, identity, and APK', async () => {
  const { validateAndroidBuild } = await import('./mobile-release.mjs');
  const app = JSON.parse(readFileSync(new URL('../apps/mobile/app.json', import.meta.url))).expo;
  const id = '57489e60-f4dc-42cf-b2b3-f8b88779a953';
  // Synthetic metadata fixture matching eas-cli 22.2.0 BuildFragment, not a live build result.
  const build = { id, platform: 'ANDROID', status: 'FINISHED', buildProfile: 'production',
    distribution: 'STORE', app: { id: app.extra.eas.projectId }, appIdentifier: app.android.package,
    artifacts: { applicationArchiveUrl: 'https://example.invalid/build.aab?token=fixture' } };
  assert.doesNotThrow(() => validateAndroidBuild(build, id, app));
  for (const change of [
    { id: 'different' }, { platform: 'IOS' }, { status: 'ERRORED' }, { status: 'IN_QUEUE' },
    { buildProfile: 'preview' }, { distribution: 'INTERNAL' }, { app: { id: 'other-project' } },
    { appIdentifier: 'another.app' }, { artifacts: {} },
    { artifacts: { applicationArchiveUrl: 'https://example.invalid/build.apk' } },
    { artifacts: { applicationArchiveUrl: 'file:///build.aab' } },
  ]) assert.throws(() => validateAndroidBuild({ ...build, ...change }, id, app));
  assert.throws(() => validateAndroidBuild(null, id, app));
});

test('submit command inspects the exact build and waits; validation/network errors never submit', async () => {
  const { submitAndroid } = await import('./mobile-release.mjs');
  const app = JSON.parse(readFileSync(new URL('../apps/mobile/app.json', import.meta.url))).expo;
  const id = '57489e60-f4dc-42cf-b2b3-f8b88779a953';
  const input = { mode: 'submit', platform: 'android', profile: 'production', androidRelease: 'public-production', buildId: id };
  const build = { id, platform: 'ANDROID', status: 'FINISHED', buildProfile: 'production', distribution: 'STORE',
    app: { id: app.extra.eas.projectId }, appIdentifier: app.android.package,
    artifacts: { applicationArchiveUrl: 'https://example.invalid/build.aab' } };
  const calls = [];
  await submitAndroid(input, app, (args) => { calls.push(args); return JSON.stringify(build); });
  assert.deepEqual(calls, [ ['build:view', id, '--json'],
    ['submit', '--platform', 'android', '--profile', 'play-production', '--id', id, '--non-interactive', '--wait'] ]);
  for (const response of [JSON.stringify({ ...build, platform: 'IOS' }), '{bad json']) {
    const rejected = [];
    await assert.rejects(() => submitAndroid(input, app, (args) => { rejected.push(args); return response; }));
    assert.equal(rejected.length, 1);
  }
  await assert.rejects(() => submitAndroid(input, app, () => { throw new Error('lookup failed'); }), /lookup failed/);
  await assert.rejects(() => submitAndroid({ ...input, buildId: '' }, app, () => assert.fail('must not call EAS')));
});

test('validation CLI writes the selected profile and fails closed on invalid public options', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-release-test-'));
  try {
    const env = { ...process.env, GITHUB_OUTPUT: join(dir, 'output'), MOBILE_MODE: 'build',
      MOBILE_PLATFORM: 'android', MOBILE_PROFILE: 'production', MOBILE_SUBMIT: 'true',
      MOBILE_ANDROID_RELEASE: 'public-production' };
    const cli = fileURLToPath(new URL('./mobile-release.mjs', import.meta.url));
    assert.equal(spawnSync(process.execPath, [cli, 'validate'], { env }).status, 0);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'submit_profile=play-production\n');
    assert.equal(spawnSync(process.execPath, [cli, 'validate'], { env: { ...env, MOBILE_PLATFORM: 'all' } }).status, 1);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'submit_profile=play-production\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build shell passes opt-in profile, preserves no-submit default, and treats messages as data', () => {
  const script = workflow.jobs.mobile.steps.find(s => s.name === 'Build').run;
  const invoke = (env) => {
    // Intercept only the external command; exercise the actual workflow shell.
    const result = spawnSync('bash', ['-e', '-c', 'pnpm() { printf "%s\\0" "$@"; };\n' + script],
      { encoding: 'utf8', env: { ...process.env, ...env } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split('\0').filter(Boolean);
  };
  const env = { MOBILE_SUBMIT: 'true', MOBILE_PLATFORM: 'android', MOBILE_PROFILE: 'production',
    SUBMIT_PROFILE: 'play-production', BUILD_MESSAGE: 'literal $(exit 99) "quotes"' };
  const args = invoke(env);
  assert.deepEqual(args, ['exec', 'eas', 'build', '--platform', 'android', '--profile', 'production',
    '--message', env.BUILD_MESSAGE, '--auto-submit-with-profile', 'play-production', '--non-interactive']);
  assert.ok(!invoke({ ...env, MOBILE_SUBMIT: 'false' }).includes('--auto-submit-with-profile'));
  assert.ok(invoke({ ...env, MOBILE_PLATFORM: 'ios', SUBMIT_PROFILE: 'production' }).includes('production'));
});
