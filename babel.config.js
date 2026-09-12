module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['module-resolver', { root: ['./src'], alias: { '@kiko': './src' } }],
    ['react-native-unistyles/plugin', { root: 'src' }],
    // `path` selects which env file react-native-dotenv inlines. It defaults to
    // '.env' (unchanged for production and for Jest, which set no ENVFILE), and
    // `ENVFILE=.env.screenshots` selects the committed screenshot-mode file for
    // the DEV/TEST-ONLY App Store screenshot build (see src/screenshot/).
    ['module:react-native-dotenv', { moduleName: '@env', path: process.env.ENVFILE || '.env' }],
    ['inline-import', { extensions: ['.sql'] }],
    // Reanimated 4 processes worklets through its worklets companion's Babel
    // plugin (NOT the legacy `react-native-reanimated/plugin`), and it must be
    // the LAST plugin so it transforms code every other plugin has already
    // emitted. react-native-sortables' drag/reorder animations run as worklets,
    // so this plugin is what makes its `worklet`-directive functions compile.
    'react-native-worklets/plugin',
  ],
};
