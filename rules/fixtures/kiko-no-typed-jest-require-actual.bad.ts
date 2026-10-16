// Jest's dependency extractor reads only `jest.requireActual('module')`, so a type argument hides
// the module from `--findRelatedTests` and from Stryker's per-test coverage.

// EXPECT-FINDING
const typedActual = jest.requireActual<{ default: number }>('react-native');

// EXPECT-FINDING
const typedMock = jest.requireMock<{ answer: number }>('react-native');

type Shape = { answer: number };

// EXPECT-FINDING
const viaAlias = jest.requireActual<Shape>('react-native');

// EXPECT-FINDING
const multiLine = jest.requireActual<{
  answer: number;
  question: string;
}>('react-native');

// EXPECT-FINDING
const brokenAcrossLines = jest
  .requireMock<
    Shape
  >(
    'react-native',
  );

// EXPECT-FINDING
const typedModule = jest.requireActual<typeof import('react-native')>('react-native');

// The extractor reads the other two module-taking names the same way.
// EXPECT-FINDING
const typedCreated = jest.createMockFromModule<Shape>('react-native');

// EXPECT-FINDING
const typedGenerated = jest.genMockFromModule<Shape>('react-native');

export {
  brokenAcrossLines,
  multiLine,
  typedActual,
  typedCreated,
  typedGenerated,
  typedMock,
  typedModule,
  viaAlias,
};
