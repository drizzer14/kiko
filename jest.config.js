module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest/setup.js'],
  // fnts ships as pure ESM; Babel must transpile it to CJS for Jest, so it is
  // exempted from the preset's node_modules transform-ignore list.
  // react-native-unistyles resolves its "react-native" package.json export
  // condition to raw untranspiled TypeScript source (by design, so Metro's
  // own pipeline can process it); Jest's RN preset resolver follows that same
  // condition, so it needs the same transform-ignore exemption.
  //
  // react-native-gesture-handler, react-native-reanimated (its Jest mock pulls
  // in the package's own ESM source), react-native-worklets, and
  // react-native-sortables all ship untranspiled ESM (`import`), so each is
  // exempted from the preset's transform-ignore list for the drag-and-drop
  // grids to load under Babel/Jest.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|fnts|react-native-unistyles|react-native-gesture-handler|react-native-reanimated|react-native-worklets|react-native-sortables)/)',
  ],
};
