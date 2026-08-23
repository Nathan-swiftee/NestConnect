/** Expo's preset plus NativeWind's JSX transform (which is what turns a
 *  `className` on a React Native component into a style object), and the
 *  Reanimated/worklets plugin, which must stay last. */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    plugins: ["react-native-worklets/plugin"],
  };
};
