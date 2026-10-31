import { useState } from 'react';
import type { LayoutMode } from '@kiko/display-regions';
import { act, renderHook } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import { SETTLE_DELAY_MS } from '../pane-stack';

import { useDraftAutosave } from '.';

const mockLayout: { mode: LayoutMode; isLarge: boolean } = { mode: 'single', isLarge: false };

jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => mockLayout.mode,
  useIsLargeWindow: () => mockLayout.isLarge,
}));

type Draft = { text: string };

// A form in miniature: one typed field, a draft built from it, and the blur handler.
const renderForm = async (saveDraft: jest.Mock, restored?: Draft) => {
  const hook = await renderHook(() => {
    const [text, setText] = useState('a');
    const onFieldBlur = useDraftAutosave<Draft>({ text }, saveDraft, restored);

    return { setText, onFieldBlur };
  });

  return hook;
};

type Form = Awaited<ReturnType<typeof renderForm>>;
type Step = (form: Form) => Promise<unknown>;

const type =
  (text: string): Step =>
  ({ result }) =>
    act(async () => result.current.setText(text));
const blur: Step = ({ result }) => act(async () => result.current.onFieldBlur());
const typeAndBlur =
  (text: string): Step =>
  ({ result }) =>
    act(async () => {
      result.current.setText(text);
      result.current.onFieldBlur();
    });
const rerenderStep: Step = ({ rerender }) => rerender({});
const setMode =
  (mode: LayoutMode): Step =>
  (form) => {
    mockLayout.mode = mode;

    return rerenderStep(form);
  };
const setLarge =
  (isLarge: boolean): Step =>
  (form) => {
    mockLayout.isLarge = isLarge;

    return rerenderStep(form);
  };
const advance =
  (milliseconds: number): Step =>
  () =>
    act(async () => jest.advanceTimersByTime(milliseconds));

type Scenario = {
  name: string;
  steps: Step[];
  saved: Draft[];
  restored?: Draft;
  mode?: LayoutMode;
  isLarge?: boolean;
};

const scenarios: Scenario[] = [
  { name: 'saves nothing on mount', steps: [], saved: [] },
  {
    name: 'saves nothing while the user types, only when a field blurs',
    steps: [type('ab'), type('abc')],
    saved: [],
  },
  {
    name: 'saves the draft once per blur',
    steps: [type('ab'), blur],
    saved: [{ text: 'ab' }],
  },
  {
    name: 'saves the draft as the blur left it, with the state changes the blur itself made',
    steps: [typeAndBlur('picked by the blur')],
    saved: [{ text: 'picked by the blur' }],
  },
  {
    name: 'saves nothing for a blur on a form the user has not changed',
    steps: [blur, blur],
    saved: [],
  },
  {
    name: 'saves again on the next blur once the user changed something',
    steps: [type('ab'), blur, type('abc'), blur],
    saved: [{ text: 'ab' }, { text: 'abc' }],
  },
  {
    name: 'saves a field changed back to what it first was, as the saved draft still holds the change',
    steps: [type('ab'), blur, type('a'), blur],
    saved: [{ text: 'ab' }, { text: 'a' }],
  },
  {
    name: 'a restored form saves nothing for a blur once the draft is back as it was',
    restored: { text: 'ab' },
    steps: [type('ab'), blur],
    saved: [],
  },
  {
    name: 'a restored form saves a change back to what it first opened as, as the route holds the restored draft',
    restored: { text: 'ab' },
    steps: [type('ab'), type('a'), blur],
    saved: [{ text: 'a' }],
  },
  {
    name: 'saves a change once, however many blurs follow it',
    steps: [type('ab'), blur, blur],
    saved: [{ text: 'ab' }],
  },
  {
    name: 'saves the draft as typed when the window changes between one pane and two',
    steps: [type('half typed'), setMode('columns')],
    saved: [{ text: 'half typed' }],
  },
  {
    name: 'saves again when the window goes back to one pane',
    steps: [type('ab'), setMode('columns'), type('abc'), setMode('single')],
    saved: [{ text: 'ab' }, { text: 'abc' }],
  },
  {
    name: 'saves nothing when the window changes over a form the user has not changed',
    steps: [setMode('columns')],
    saved: [],
  },
  {
    name: 'saves nothing for a rerender that leaves the layout mode as it was',
    steps: [rerenderStep, rerenderStep],
    saved: [],
  },
  {
    name: 'saves the draft as typed once the window that became large has settled',
    mode: 'columns',
    steps: [type('half typed'), setLarge(true), advance(SETTLE_DELAY_MS)],
    saved: [{ text: 'half typed' }],
  },
  {
    name: 'saves the draft as typed once the window that stopped being large has settled',
    mode: 'columns',
    isLarge: true,
    steps: [type('half typed'), setLarge(false), advance(SETTLE_DELAY_MS)],
    saved: [{ text: 'half typed' }],
  },
  {
    name: 'saves nothing when the window becomes large over a form the user has not changed',
    mode: 'columns',
    steps: [setLarge(true), advance(SETTLE_DELAY_MS)],
    saved: [],
  },
  {
    name: 'saves nothing for a rerender that leaves the window as large as it was',
    mode: 'columns',
    isLarge: true,
    steps: [type('half typed'), rerenderStep],
    saved: [],
  },
  {
    name: 'saves nothing before the large window has lasted the settle delay',
    mode: 'columns',
    steps: [type('ab'), setLarge(true), advance(SETTLE_DELAY_MS - 1)],
    saved: [],
  },
  // The Home and Statistics tabs merge only when the large window has settled, and that is the
  // moment the form is carried, so the draft saved then must hold what was typed during the wait.
  {
    name: 'saves the text typed during the settle delay once the tabs merge',
    mode: 'columns',
    steps: [type('ab'), setLarge(true), type('typed during the delay'), advance(SETTLE_DELAY_MS)],
    saved: [{ text: 'typed during the delay' }],
  },
];

describe('useDraftAutosave', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLayout.mode = 'single';
    mockLayout.isLarge = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(scenarios)('$name', async ({ steps, saved, restored, mode, isLarge }) => {
    mockLayout.mode = mode ?? 'single';
    mockLayout.isLarge = isLarge ?? false;
    const saveDraft = jest.fn();
    const form = await renderForm(saveDraft, restored);

    for (const step of steps) {
      await step(form);
    }

    expect(saveDraft.mock.calls).toEqual(saved.map((draft) => [draft]));
  });

  it('keeps one handler across renders, so the fields it is handed to do not re-render', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);
    const first = result.current.onFieldBlur;

    await act(async () => result.current.setText('ab'));

    expect(result.current.onFieldBlur).toBe(first);
  });
});
