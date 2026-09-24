import { match } from 'ts-pattern';
import { Pressable, Text } from 'react-native';
import { type FC, useRef, useState, useEffect } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';

import '../design-system/unistyles';

import type { AccountsStackParamList } from './types';

/**
 * C1 (F3 part 1, fix round 1, Critical): `navigation.navigate(name, params)`
 * on React Navigation 7.3.17 PUSHES a new screen unless the target is
 * already the CURRENT route, `getId` matches, or `{ pop: true }` is passed
 * (`node_modules/@react-navigation/routers/src/StackRouter.tsx`'s `NAVIGATE`
 * case) — it does NOT pop back to an earlier instance the way React
 * Navigation 6 did. `statement-import.screen.tsx`'s `handleImportDone`,
 * `column-mapping.screen.tsx`'s `handleImportDone`, and both
 * `HoldingFormScreen` `returnTo` branches used to call plain `navigate` for
 * exactly this "return to an already-on-stack screen" case, which pushed a
 * duplicate instead of reusing the existing one — the fix is `popTo` (this
 * file exercises production's own `.popTo(name, params, { merge: true })`
 * shape against the REAL `@react-navigation/routers` `StackRouter`, not a
 * `navigationSpy`, because — per the reviewer's own repro — "a spy cannot
 * see the router semantics": a spy only proves the CALL happened, never
 * whether the router pushed or popped.
 *
 * This suite proves the ROUTER-LEVEL property the fix depends on (a route
 * already on the stack is REUSED, not duplicated, and that surviving
 * instance's own local React state is preserved) using a REAL
 * `NavigationContainer` + `createNativeStackNavigator` (no mock). Each
 * stand-in screen below mirrors the EXACT `popTo`/`navigate` call shape its
 * real counterpart uses, cited by file:line — the companion, per-screen
 * `navigationSpy` tests (`statement-import.screen.test.tsx`,
 * `column-mapping.screen.test.tsx`, `holding-form.screen.test.tsx`)
 * separately prove PRODUCTION code actually invokes that exact shape;
 * together the two suites cover both "did we call the right thing" and
 * "does calling the right thing produce the right router outcome".
 */

const Stack = createNativeStackNavigator<AccountsStackParamList>();

// A minimal external-store stand-in for the shared `settings` row
// `savedMappings` is read from (`useLiveQuery(settingsRepo.getQuery(), …)`
// in the real screens) — every mounted subscriber re-renders the instant
// `setSavedMappingMatches` fires, exactly like a live settings-table write
// notifies every reader, including one sitting blurred underneath a pushed
// screen.
let savedMappingMatches = false;
const savedMappingListeners = new Set<() => void>();
const setSavedMappingMatches = (matches: boolean): void => {
  savedMappingMatches = matches;

  for (const listener of savedMappingListeners) {
    listener();
  }
};
const useSavedMappingMatches = (): boolean => {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = (): void => forceRender((n) => n + 1);
    savedMappingListeners.add(listener);

    return () => {
      savedMappingListeners.delete(listener);
    };
  }, []);

  return savedMappingMatches;
};

const AccountDetailStub: FC<NativeStackScreenProps<AccountsStackParamList, 'AccountDetail'>> = ({
  route,
  navigation,
}) => (
  <>
    <Text testID="screen-account-detail">AccountDetail {route.params.accountId}</Text>
    <Pressable
      testID="push-statement-import"
      onPress={() =>
        navigation.navigate('StatementImport', { filePath: 'f.csv', accountId: 'acc-1' })
      }
    >
      <Text>Import statement</Text>
    </Pressable>
  </>
);

// Mirrors statement-import.screen.tsx:439-444 (handleMapColumnsManually,
// a genuine PUSH — ColumnMapping is not yet on the stack, so `navigate` is
// correct there and stays `navigate`, not `popTo`) and :419-431
// (handleImportDone, fixed to `popTo` — the case under test here). The
// `evaluatedRef`-guarded effect below mirrors that same file's own
// auto-replace effect shape (decides at most once, against whatever
// `savedMappingMatches` snapshot is available the first time it runs, and
// never revisits that decision on a later change).
const StatementImportStub: FC<
  NativeStackScreenProps<AccountsStackParamList, 'StatementImport'>
> = ({ route, navigation }) => {
  const savedMappingMatchesSnapshot = useSavedMappingMatches();
  const evaluatedRef = useRef(false);

  useEffect(() => {
    if (evaluatedRef.current) {
      return;
    }

    evaluatedRef.current = true;

    if (!navigation.isFocused()) {
      return;
    }

    if (savedMappingMatchesSnapshot) {
      navigation.replace('ColumnMapping', {
        filePath: route.params.filePath,
        accountId: route.params.accountId ?? 'acc-1',
        ownsFile: true,
      });
    }
  }, [savedMappingMatchesSnapshot, navigation, route.params]);

  return (
    <>
      <Text testID="screen-statement-import">StatementImport</Text>
      <Pressable
        testID="push-column-mapping"
        onPress={() =>
          navigation.navigate('ColumnMapping', {
            filePath: route.params.filePath,
            accountId: route.params.accountId ?? 'acc-1',
          })
        }
      >
        <Text>Map columns manually</Text>
      </Pressable>
      <Pressable
        testID="push-holding-form-from-preview"
        onPress={() =>
          navigation.navigate('HoldingForm', {
            accountId: route.params.accountId ?? 'acc-1',
            returnTo: { screen: 'StatementImport', params: route.params },
          })
        }
      >
        <Text>Create new holding</Text>
      </Pressable>
      <Pressable
        testID="done"
        onPress={() =>
          navigation.popTo(
            'AccountDetail',
            { accountId: route.params.accountId ?? 'acc-1', name: 'Acc' },
            { merge: true },
          )
        }
      >
        <Text>Done</Text>
      </Pressable>
    </>
  );
};

// Mirrors column-mapping.screen.tsx's own "Create new holding" (a genuine
// PUSH, stays `navigate`) and its `handleImportDone` (fixed to `popTo`).
// The local `dateColumn` state stands in for the real screen's own column
// choices (date/amount/description column, decimal separator, etc.) — any
// local `useState` demonstrates the SAME router property: it survives a
// `popTo` round trip only because the router REUSES this exact component
// instance rather than unmounting and remounting a fresh one.
const ColumnMappingStub: FC<NativeStackScreenProps<AccountsStackParamList, 'ColumnMapping'>> = ({
  route,
  navigation,
}) => {
  const [dateColumn, setDateColumn] = useState<number | undefined>(undefined);
  const [importResultVisible, setImportResultVisible] = useState(false);

  return (
    <>
      <Text testID="screen-column-mapping">ColumnMapping</Text>
      <Text testID="column-mapping-date-column">{dateColumn ?? 'unset'}</Text>
      <Text testID="column-mapping-holding">{route.params.holdingId ?? 'none'}</Text>
      <Text testID="import-result">{importResultVisible ? 'shown' : 'hidden'}</Text>
      <Pressable testID="pick-date-column" onPress={() => setDateColumn(0)}>
        <Text>Pick date column</Text>
      </Pressable>
      <Pressable
        testID="push-holding-form-from-mapping"
        onPress={() =>
          navigation.navigate('HoldingForm', {
            accountId: route.params.accountId,
            returnTo: { screen: 'ColumnMapping', params: route.params },
          })
        }
      >
        <Text>Create new holding</Text>
      </Pressable>
      <Pressable
        testID="import"
        onPress={() => {
          // Mirrors column-mapping.screen.tsx's own `handleImport`: shows the
          // success sheet FIRST, then saves the mapping — a write that
          // notifies every mounted subscriber, including a blurred
          // StatementImport instance sitting beneath this pushed screen.
          setImportResultVisible(true);
          setSavedMappingMatches(true);
        }}
      >
        <Text>Import</Text>
      </Pressable>
      <Pressable
        testID="done-column-mapping"
        onPress={() =>
          navigation.popTo(
            'AccountDetail',
            { accountId: route.params.accountId, name: 'Acc' },
            { merge: true },
          )
        }
      >
        <Text>Done</Text>
      </Pressable>
    </>
  );
};

// Mirrors holding-form.screen.tsx's create-save `returnTo` branches
// (1321-1328): a `ts-pattern` exhaustive `match` narrowing the `returnTo`
// union so each branch's `params` type-checks against its own screen,
// fixed from `navigate` to `popTo(..., { merge: true })`.
const HoldingFormStub: FC<NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>> = ({
  route,
  navigation,
}) => (
  <Pressable
    testID="save-holding"
    onPress={() => {
      const { returnTo } = route.params;

      if (returnTo === undefined) {
        return;
      }

      match(returnTo)
        .with({ screen: 'StatementImport' }, ({ params }) =>
          navigation.popTo(
            'StatementImport',
            { ...params, holdingId: 'new-holding-id' },
            { merge: true },
          ),
        )
        .with({ screen: 'ColumnMapping' }, ({ params }) =>
          navigation.popTo(
            'ColumnMapping',
            { ...params, holdingId: 'new-holding-id' },
            { merge: true },
          ),
        )
        .exhaustive();
    }}
  >
    <Text>Save</Text>
  </Pressable>
);

const navigationRef = createNavigationContainerRef<AccountsStackParamList>();

const renderNavigator = () =>
  render(
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator initialRouteName="AccountDetail">
        <Stack.Screen
          name="AccountDetail"
          component={AccountDetailStub}
          initialParams={{ accountId: 'acc-1', name: 'Acc' }}
        />
        <Stack.Screen name="StatementImport" component={StatementImportStub} />
        <Stack.Screen name="ColumnMapping" component={ColumnMappingStub} />
        <Stack.Screen name="HoldingForm" component={HoldingFormStub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );

const routeNames = (): (keyof AccountsStackParamList)[] =>
  (navigationRef.getState()?.routes ?? []).map((r) => r.name as keyof AccountsStackParamList);

describe('statement-import return-navigation (C1, real router)', () => {
  beforeEach(() => {
    savedMappingMatches = false;
  });

  it('item 2 (Map Columns path): "Create new holding" returns to the SAME ColumnMapping instance, keeping its state and selecting the new holding — no duplicate route', async () => {
    const view = await renderNavigator();

    await fireEvent.press(view.getByTestId('push-statement-import'));
    await fireEvent.press(view.getByTestId('push-column-mapping'));
    // The user's own column choice, made BEFORE creating a new holding.
    await fireEvent.press(view.getByTestId('pick-date-column'));

    expect(view.getByTestId('column-mapping-date-column')).toHaveTextContent('0');

    await fireEvent.press(view.getByTestId('push-holding-form-from-mapping'));
    await fireEvent.press(view.getByTestId('save-holding'));

    // No duplicate ColumnMapping (or leftover HoldingForm) on the stack —
    // the real StackRouter's own state, not a spy's call log.
    expect(routeNames()).toEqual(['AccountDetail', 'StatementImport', 'ColumnMapping']);
    expect(view.queryAllByTestId('screen-column-mapping')).toHaveLength(1);

    // The SAME component instance survived: its local state (the date
    // column choice) is still '0', not reset to 'unset' by a remount.
    expect(view.getByTestId('column-mapping-date-column')).toHaveTextContent('0');
    // ...and the newly created holding is selected via the merged param.
    expect(view.getByTestId('column-mapping-holding')).toHaveTextContent('new-holding-id');
  });

  it('item 2 (preview path): "Create new holding" returns to the SAME StatementImport preview instance — no duplicate route', async () => {
    const view = await renderNavigator();

    await fireEvent.press(view.getByTestId('push-statement-import'));
    await fireEvent.press(view.getByTestId('push-holding-form-from-preview'));
    await fireEvent.press(view.getByTestId('save-holding'));

    expect(routeNames()).toEqual(['AccountDetail', 'StatementImport']);
    expect(view.queryAllByTestId('screen-statement-import')).toHaveLength(1);
  });

  it('item 15: Done lands on the EXISTING AccountDetail instance — no duplicate account screen', async () => {
    const view = await renderNavigator();

    await fireEvent.press(view.getByTestId('push-statement-import'));
    await fireEvent.press(view.getByTestId('done'));

    expect(routeNames()).toEqual(['AccountDetail']);
    expect(view.queryAllByTestId('screen-account-detail')).toHaveLength(1);
  });

  it('a saved-mapping write while the pushed ColumnMapping sheet is open does not swap out the live instance', async () => {
    const view = await renderNavigator();

    await fireEvent.press(view.getByTestId('push-statement-import'));
    await fireEvent.press(view.getByTestId('push-column-mapping'));
    // The user's own column choice, made BEFORE the write below — proves the
    // instance below survives, not just the route name.
    await fireEvent.press(view.getByTestId('pick-date-column'));

    const columnMappingRouteKeyBefore = navigationRef
      .getState()
      ?.routes.find((r) => r.name === 'ColumnMapping')?.key;

    // Mirrors the real bug: ColumnMapping's own Import shows its success
    // sheet, then saves the mapping — a write that notifies EVERY mounted
    // subscriber, including the blurred StatementImport instance beneath it.
    await fireEvent.press(view.getByTestId('import'));

    expect(routeNames()).toEqual(['AccountDetail', 'StatementImport', 'ColumnMapping']);
    expect(view.queryAllByTestId('screen-column-mapping')).toHaveLength(1);
    expect(navigationRef.getState()?.routes.find((r) => r.name === 'ColumnMapping')?.key).toBe(
      columnMappingRouteKeyBefore,
    );
    // The SAME instance survived the write: its local state (the date column
    // choice) is still '0', not reset by an unmount/remount, and the success
    // sheet the write happened underneath is still showing.
    expect(view.getByTestId('column-mapping-date-column')).toHaveTextContent('0');
    expect(view.getByTestId('import-result')).toHaveTextContent('shown');

    await fireEvent.press(view.getByTestId('done-column-mapping'));

    expect(routeNames()).toEqual(['AccountDetail']);
  });
});
