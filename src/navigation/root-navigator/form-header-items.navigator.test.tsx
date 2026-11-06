import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import type { LayoutMode } from '@kiko/display-regions';
import { headerConfigsIn } from '@kiko/test-support/header-configs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from '../home-stack';
import StatisticsStack from '../statistics-stack';

/**
 * Where the stack draws a back button is a native-stack property a `navigationSpy` cannot see, so
 * this suite renders the REAL Home and Statistics pane stacks and the real native-stack header,
 * with the form screen swapped for a stand-in that registers the same nav-bar pair the real form
 * does (`useFormHeaderItems`). It reads the items the native header config is handed, per layout,
 * and presses them the way the native bar reports a press.
 */

const mockLayout = { mode: 'columns' as LayoutMode };

jest.mock('@kiko/display-regions', () => ({
  ...jest.requireActual('@kiko/display-regions'),
  useLayoutMode: () => mockLayout.mode,
  useFoldRegion: () => null,
}));

// The way Home opens a form: in the pane opposite its own. Both stacks show each other's root, so
// a test names the screen whose button it presses.
function mockOpeningScreen(name: string) {
  const { Pressable, Text } = require('react-native');
  const { useOpenInPane } = require('@kiko/navigation/pane-stack');

  const OpeningScreen = () => {
    const openInPane = useOpenInPane();

    return (
      <Pressable testID={`open-form-${name}`} onPress={() => openInPane('TransactionForm', {})}>
        <Text>Add transaction</Text>
      </Pressable>
    );
  };

  return { __esModule: true, default: OpeningScreen };
}

jest.mock('@kiko/screens/home', () => mockOpeningScreen('Home'));

jest.mock('@kiko/screens/statistics', () => mockOpeningScreen('Statistics'));

jest.mock('@kiko/screens/forms/transaction-form', () => {
  const { useLayoutEffect } = require('react');
  const { useFormHeaderItems } = require('@kiko/screens/forms/use-form-header-items');

  const FormStub = ({
    navigation,
  }: {
    navigation: { goBack: () => void; setOptions: (options: object) => void };
  }) => {
    useLayoutEffect(() => {
      navigation.setOptions({ title: 'Form' });
    }, [navigation]);

    useFormHeaderItems({ navigation, onSave: jest.fn(), hasSave: true, isSaving: false });

    return null;
  };

  return { __esModule: true, default: FormStub };
});

const navigationRef = createNavigationContainerRef<ParamListBase>();

type HeaderItem = { title: string; buttonId: string };

type HeaderConfigProps = {
  title?: string;
  headerLeftBarButtonItems?: HeaderItem[];
  headerRightBarButtonItems?: HeaderItem[];
  onPressHeaderBarButtonItem?: (event: { nativeEvent: { buttonId: string } }) => void;
};

// The native header config of the form's screen, as native-stack hands it to the native side.
const formHeader = (): HeaderConfigProps => {
  const configs = headerConfigsIn<HeaderConfigProps>(screen.toJSON()).filter(
    (config) => config.title === 'Form',
  );

  expect(configs).toHaveLength(1);

  return configs[0];
};

const titles = (items: HeaderItem[] | undefined): string[] =>
  (items ?? []).map((item) => item.title);

const renderStack = async (Stack: typeof HomeStack) => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Stack />
    </NavigationContainer>,
  );
  await waitFor(() => expect(navigationRef.isReady()).toBe(true));
};

const openForm = async (name: 'Home' | 'Statistics') => {
  await fireEvent.press(screen.getByTestId(`open-form-${name}`));
};

const routeNames = (): string[] =>
  (navigationRef.getRootState()?.routes ?? []).map((route) => route.name);

describe('the form header pair, per layout', () => {
  describe('in two panes, where the form is the first screen of its pane', () => {
    beforeEach(() => {
      mockLayout.mode = 'columns';
    });

    it('shows Cancel leading and a prominent Save trailing, and Cancel closes the form', async () => {
      await renderStack(HomeStack);
      await openForm('Home');

      expect(routeNames()).toEqual(['Home', 'TransactionForm']);
      expect(titles(formHeader().headerLeftBarButtonItems)).toEqual(['Cancel']);
      expect(titles(formHeader().headerRightBarButtonItems)).toEqual(['Save']);

      await act(async () => {
        formHeader().onPressHeaderBarButtonItem?.({
          nativeEvent: { buttonId: formHeader().headerLeftBarButtonItems?.[0].buttonId ?? '' },
        });
      });

      expect(routeNames()).toEqual(['Home']);
    });
  });

  describe('in one pane, where the form is pushed over a screen and has a back button', () => {
    beforeEach(() => {
      mockLayout.mode = 'single';
    });

    it('shows no Cancel, only the prominent Save', async () => {
      await renderStack(StatisticsStack);
      await openForm('Statistics');

      expect(routeNames()).toEqual(['Statistics', 'TransactionForm']);
      expect(titles(formHeader().headerLeftBarButtonItems)).toEqual([]);
      expect(titles(formHeader().headerRightBarButtonItems)).toEqual(['Save']);
    });
  });
});
