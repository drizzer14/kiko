import { readRouteEntry } from './route-entry';

const NO_TEMPLATE = {
  templateId: null,
  editTemplateId: null,
  isNewTemplate: false,
  templateQueryId: '',
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
      templateSeat: 'keepPage',
    });
    expect(readRouteEntry({ transactionId: 't1' })).toMatchObject({
      editingId: 't1',
      isEmptyCreate: false,
      seedsDefaultHolding: false,
      templateSeat: 'clear',
    });
    expect(readRouteEntry({ duplicateOfTransactionId: 't1' })).toMatchObject({
      duplicateOfId: 't1',
      isEmptyCreate: false,
      seedsDefaultHolding: false,
      templateSeat: 'clear',
    });
  });

  it('reads the global add as an empty create that seeds the default and clears the seam on a template', () => {
    expect(readRouteEntry({})).toEqual({
      ...NO_TEMPLATE,
      editingId: null,
      duplicateOfId: null,
      holdingParamId: null,
      isEmptyCreate: true,
      seedsDefaultHolding: true,
      templateSeat: 'clear',
    });
  });

  it('reads a template to create from: the holding is not fixed, and no default seeds before the fill', () => {
    expect(readRouteEntry({ templateId: 'tpl1' })).toMatchObject({
      templateId: 'tpl1',
      templateQueryId: 'tpl1',
      editTemplateId: null,
      isNewTemplate: false,
      isEmptyCreate: true,
      seedsDefaultHolding: false,
      templateSeat: 'clear',
    });
  });

  it('reads a template to edit: the holding is not fixed, and no default seeds before the fill', () => {
    expect(readRouteEntry({ editTemplateId: 'tpl1' })).toMatchObject({
      templateId: null,
      templateQueryId: 'tpl1',
      editTemplateId: 'tpl1',
      isNewTemplate: false,
      isEmptyCreate: true,
      seedsDefaultHolding: false,
      templateSeat: 'clear',
    });
  });

  it('reads a new template like the global add, so its holding picker seeds the default', () => {
    expect(readRouteEntry({ newTemplate: true })).toMatchObject({
      templateId: null,
      editTemplateId: null,
      isNewTemplate: true,
      isEmptyCreate: true,
      seedsDefaultHolding: true,
      templateSeat: 'clear',
    });
  });
});
