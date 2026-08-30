module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest/setup.js'],
  // fnts ships as pure ESM; Babel must transpile it to CJS for Jest, so it is
  // exempted from the preset's node_modules transform-ignore list.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|fnts)/)',
  ],
};
