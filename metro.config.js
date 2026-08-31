const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * `sql` is added to the resolver's source extensions so Metro can bundle the
 * drizzle-orm migration `.sql` files imported by `drizzle/migrations/migrations.js`.
 * The `.sql` files are turned into string exports by `babel-plugin-inline-import`
 * (configured in `babel.config.js`), per the drizzle-orm React Native setup.
 * https://orm.drizzle.team/docs/get-started/expo-new
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    sourceExts: [...defaultConfig.resolver.sourceExts, 'sql'],
  },
};

module.exports = mergeConfig(defaultConfig, config);
