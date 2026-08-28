/**
 * Rendering the app the way the phone does, not the way a browser does.
 *
 * Every UI regression in this app that reached a device got there because it
 * was checked against a `expo export -p web` build in a headless browser, and
 * react-native-web resolves NativeWind and Reanimated differently from the
 * native runtime. It has shown a correctly styled, correctly animating button
 * three separate times while the phone showed a white glyph on nothing.
 *
 * `jest-expo` runs a component through the *native* module resolution —
 * `.native.js` before `.js`, `react-native` rather than `react-native-web` —
 * so `react-native-css-interop` takes the same code path it takes on the
 * device. That is enough to see which styles actually reach a component.
 *
 * What this can and cannot do, stated plainly: it renders and reports props and
 * styles. It does not run Yoga, so it cannot measure a layout — a row's height
 * is still something only a device can tell you. `scripts/check-layout-rules.mjs`
 * covers the layout cases statically, for the same reason.
 */
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
  // Reanimated's worklets runtime has no native module under Jest. This is the
  // resolver `react-native-worklets` ships for exactly that: it drops the
  // `.native` extension for its own files so the JS implementation loads. It is
  // scoped to worklets, so NativeWind still resolves the way the phone does —
  // which is the entire point of running these here.
  resolver: "react-native-worklets/jest/resolver.js",
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|react-native-css-interop|react-native-reanimated|react-native-gesture-handler))",
  ],
};
