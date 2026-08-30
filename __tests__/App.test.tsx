/**
 * @format
 */

import * as ReactNative from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

function renderApp(): ReactTestRenderer.ReactTestRenderer {
  let result: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    result = ReactTestRenderer.create(<App />);
  });
  if (!result) {
    throw new Error('ReactTestRenderer.create did not return a renderer');
  }
  return result;
}

describe('App', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders dark-content status bar when the color scheme is light', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    const statusBar = renderApp().root.findByType(ReactNative.StatusBar);
    expect(statusBar.props.barStyle).toBe('dark-content');
  });

  test('renders light-content status bar when the color scheme is dark', () => {
    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('dark');
    const statusBar = renderApp().root.findByType(ReactNative.StatusBar);
    expect(statusBar.props.barStyle).toBe('light-content');
  });

  test('applies flex: 1 to the app container', () => {
    const container = renderApp().root.findByType(ReactNative.View);
    expect(container.props.style).toEqual({ flex: 1 });
  });
});
