// The module stays a plain string literal in an untyped call, so the dependency extractor sees it.
const castActual = jest.requireActual('react-native') as { answer: number };

const annotatedActual: { answer: number } = jest.requireActual('react-native');

const castMock = jest.requireMock('react-native') as { answer: number };

const spreadActual = { ...jest.requireActual('react-native') };

const castCreated = jest.createMockFromModule('react-native') as { answer: number };

const annotatedGenerated: { answer: number } = jest.genMockFromModule('react-native');

// A generic elsewhere on the line is not a type argument of the call.
const entries = new Map<string, number>([['answer', jest.requireActual('react-native').answer]]);

const comparison = Math.max(1, 2) < 3;

export {
  annotatedActual,
  annotatedGenerated,
  castActual,
  castCreated,
  castMock,
  comparison,
  entries,
  spreadActual,
};
