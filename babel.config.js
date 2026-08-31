module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['react-native-unistyles/plugin', { root: 'src' }],
    ['module:react-native-dotenv', { moduleName: '@env', path: '.env' }],
    ['inline-import', { extensions: ['.sql'] }],
  ],
};
