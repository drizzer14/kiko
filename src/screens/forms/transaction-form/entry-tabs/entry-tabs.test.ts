import type { TransactionTemplateRow } from '@kiko/db';

import { awaitsTemplatePick, resolveSelectedTemplate } from './entry-tabs';

const rowOf = (id: string): TransactionTemplateRow => ({
  id,
  name: id,
  draft: {},
  createdAt: 1,
  updatedAt: 1,
});

describe('awaitsTemplatePick', () => {
  it.each([
    ['Template with nothing picked', true, 'template', null, false, true],
    ['Template with a pick', true, 'template', 't1', false, false],
    ['Template while the route template loads', true, 'template', null, true, false],
    ['Manual with nothing picked', true, 'manual', null, false, false],
    ['Manual with a pick', true, 'manual', 't1', false, false],
    ['an entry with no tabs, whatever the tab holds', false, 'template', null, false, false],
  ] as const)(
    'on %s is %s',
    (_name, hasEntryTabs, tab, selectedTemplateId, isEntryTemplateLoading, expected) => {
      expect(
        awaitsTemplatePick({ hasEntryTabs, tab, selectedTemplateId, isEntryTemplateLoading }),
      ).toBe(expected);
    },
  );
});

describe('resolveSelectedTemplate', () => {
  const templates = [rowOf('t1'), rowOf('t2')];

  it('is the entry template while nothing has been picked', () => {
    expect(
      resolveSelectedTemplate({ pickedId: null, templates, entryTemplate: rowOf('t1') }),
    ).toEqual({ template: rowOf('t1'), id: 't1' });
  });

  it('is the picked template over the entry one', () => {
    expect(
      resolveSelectedTemplate({ pickedId: 't2', templates, entryTemplate: rowOf('t1') }),
    ).toEqual({ template: rowOf('t2'), id: 't2' });
  });

  it('falls back to the entry template when the picked one is no longer listed', () => {
    expect(
      resolveSelectedTemplate({ pickedId: 'gone', templates, entryTemplate: rowOf('t1') }),
    ).toEqual({ template: rowOf('t1'), id: 't1' });
  });

  it('is nothing picked when neither resolves', () => {
    expect(
      resolveSelectedTemplate({ pickedId: null, templates, entryTemplate: undefined }),
    ).toEqual({ template: undefined, id: null });
  });
});
