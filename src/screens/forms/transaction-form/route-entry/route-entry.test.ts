import { readRouteEntry } from './route-entry';

const NO_TEMPLATE = {
  editTemplateId: null,
  templateEntry: null,
  templateQueryId: '',
  hasEntryTabs: true,
  initialTab: 'manual',
};

describe('readRouteEntry', () => {
  it('reads the three transaction entries as before, with no template', () => {
    expect(readRouteEntry({ holdingId: 'h1' })).toEqual({
      ...NO_TEMPLATE,
      editingId: null,
      duplicateOfId: null,
      holdingParamId: 'h1',
      isEmptyCreate: false,
      seedsDefaultHolding: false,
    });
    expect(readRouteEntry({ transactionId: 't1' })).toMatchObject({
      editingId: 't1',
      isEmptyCreate: false,
      seedsDefaultHolding: false,
    });
    expect(readRouteEntry({ duplicateOfTransactionId: 't1' })).toMatchObject({
      duplicateOfId: 't1',
      isEmptyCreate: false,
      seedsDefaultHolding: false,
    });
  });

  it('reads the global add as an empty create that seeds the default', () => {
    expect(readRouteEntry({})).toEqual({
      ...NO_TEMPLATE,
      editingId: null,
      duplicateOfId: null,
      holdingParamId: null,
      isEmptyCreate: true,
      seedsDefaultHolding: true,
    });
  });

  it.each([
    ['a global add', {}, true],
    ['an add from a holding', { holdingId: 'h1' }, true],
    ['a template to create from', { templateId: 'tpl1' }, true],
    ['an edit', { transactionId: 't1' }, false],
    ['a duplicate', { duplicateOfTransactionId: 't1' }, false],
    ['a template to edit', { editTemplateId: 'tpl1' }, false],
    ['a new template', { newTemplate: true }, false],
  ] as const)('reads %s with entry tabs: %s', (_name, params, hasEntryTabs) => {
    expect(readRouteEntry(params).hasEntryTabs).toBe(hasEntryTabs);
  });

  it('opens on the Template tab only for a template to create from', () => {
    expect(readRouteEntry({ templateId: 'tpl1' }).initialTab).toBe('template');
    expect(readRouteEntry({}).initialTab).toBe('manual');
    expect(readRouteEntry({ holdingId: 'h1' }).initialTab).toBe('manual');
    expect(readRouteEntry({ editTemplateId: 'tpl1' }).initialTab).toBe('manual');
  });

  it('reads a template to create from: the holding is not fixed, and no default seeds before the fill', () => {
    expect(readRouteEntry({ templateId: 'tpl1' })).toMatchObject({
      templateQueryId: 'tpl1',
      editTemplateId: null,
      isEmptyCreate: true,
      seedsDefaultHolding: false,
    });
  });

  it('reads a template to edit: the holding is not fixed, and no default seeds before the fill', () => {
    expect(readRouteEntry({ editTemplateId: 'tpl1' })).toMatchObject({
      templateQueryId: 'tpl1',
      editTemplateId: 'tpl1',
      templateEntry: 'edit',
      isEmptyCreate: true,
      seedsDefaultHolding: false,
    });
  });

  it('reads a new template like the global add, so its holding picker seeds the default', () => {
    expect(readRouteEntry({ newTemplate: true })).toMatchObject({
      editTemplateId: null,
      templateEntry: 'add',
      isEmptyCreate: true,
      seedsDefaultHolding: true,
    });
  });
});
