// Under Jest `findNodeHandle` returns null for every host (there is no native renderer), so a
// test that pins "this control's handle reaches the share call" needs a stand-in that gives each
// distinct host its own number. Wire it with the one below; the call stays lazy so the import it
// reads from is assigned by the time a host is looked up, however the test's imports are ordered:
//   jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({
//     ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'),
//     findNodeHandle: (node: unknown) => mockFindNodeHandle(node),
//   }));
const FIRST_HANDLE = 101;

const handles = new Map<unknown, number>();

export const mockFindNodeHandle = (node: unknown): number | null => {
  if (node === null || node === undefined) {
    return null;
  }

  // A test reaches a host through a query (a TestInstance wrapper) while the code under test
  // holds the View instance from its ref; the two are different objects that carry the same
  // testID, so a testID is the identity when there is one. Keying by props.testID collides when
  // two host views share a testID: they then get one handle.
  const testID = (node as { props?: { testID?: string } }).props?.testID;
  const key = testID ?? node;
  const known = handles.get(key);

  if (known !== undefined) {
    return known;
  }

  const next = FIRST_HANDLE + handles.size;
  handles.set(key, next);

  return next;
};
