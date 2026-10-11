import { EMPTY_DRAFT } from '@kiko/transaction-templates/draft';
import { TemplateNameTakenError } from '@kiko/transaction-templates/repo';

import { writeTemplate } from './template-save';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@kiko/transaction-templates/repo', () => ({
  ...jest.requireActual('@kiko/transaction-templates/repo'),
  transactionTemplatesRepo: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

describe('writeTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a template when none is being edited', async () => {
    mockCreate.mockResolvedValue('new');

    await expect(
      writeTemplate({ editTemplateId: null, name: 'Rent', draft: EMPTY_DRAFT }),
    ).resolves.toBe('saved');
    expect(mockCreate).toHaveBeenCalledWith({ name: 'Rent', draft: EMPTY_DRAFT });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('updates the template being edited', async () => {
    mockUpdate.mockResolvedValue(undefined);

    await expect(
      writeTemplate({ editTemplateId: 'tpl', name: 'Rent', draft: EMPTY_DRAFT }),
    ).resolves.toBe('saved');
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'tpl', name: 'Rent', draft: EMPTY_DRAFT });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('reports a name the write itself refused as taken', async () => {
    mockCreate.mockRejectedValue(new TemplateNameTakenError());
    mockUpdate.mockRejectedValue(new TemplateNameTakenError());

    await expect(
      writeTemplate({ editTemplateId: null, name: 'Rent', draft: EMPTY_DRAFT }),
    ).resolves.toBe('taken');
    await expect(
      writeTemplate({ editTemplateId: 'tpl', name: 'Rent', draft: EMPTY_DRAFT }),
    ).resolves.toBe('taken');
  });

  it('rethrows any other failure for the form to alert on', async () => {
    const failure = new Error('disk full');

    mockCreate.mockRejectedValue(failure);

    await expect(
      writeTemplate({ editTemplateId: null, name: 'Rent', draft: EMPTY_DRAFT }),
    ).rejects.toBe(failure);
  });
});
