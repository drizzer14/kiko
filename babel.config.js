module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['module-resolver', { root: ['./src'], alias: { '@kiko': './src' } }],
    ['react-native-unistyles/plugin', { root: 'src' }],
    ['module:react-native-dotenv', { moduleName: '@env', path: '.env' }],
    ['inline-import', { extensions: ['.sql'] }],
    // Reanimated 4 processes worklets through its worklets companion's Babel
    // plugin (NOT the legacy `react-native-reanimated/plugin`), and it must be
    // the LAST plugin so it transforms code every other plugin has already
    // emitted. react-native-sortables' drag/reorder animations run as worklets,
    // so this plugin is what makes its `worklet`-directive functions compile.
    'react-native-worklets/plugin',
  ],
};
