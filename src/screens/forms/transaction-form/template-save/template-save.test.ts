import { EMPTY_DRAFT } from '@kiko/transaction-templates/draft';
import { TemplateNameTakenError } from '@kiko/transaction-templates/repo';

import { alongsideArguments, writeTemplate } from './template-save';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockInsert = jest.fn();

jest.mock('@kiko/transaction-templates/repo', () => ({
  ...jest.requireActual('@kiko/transaction-templates/repo'),
  transactionTemplatesRepo: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    insertDatabaseTransaction: (...args: unknown[]) => mockInsert(...args),
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

describe('alongsideArguments', () => {
  const databaseTransaction = { marker: 'inside the write' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is no argument at all while the switch is off, so the write gets none', () => {
    expect(alongsideArguments({ enabled: false, name: 'Rent', draft: EMPTY_DRAFT })).toEqual([]);
  });

  it('is one step that inserts the template through the write it runs in', async () => {
    mockInsert.mockResolvedValue('new');

    const [alongside, ...rest] = alongsideArguments({
      enabled: true,
      name: 'Rent',
      draft: EMPTY_DRAFT,
    });

    expect(rest).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();

    await expect(alongside?.(databaseTransaction)).resolves.toBeUndefined();
    expect(mockInsert).toHaveBeenCalledWith(databaseTransaction, {
      name: 'Rent',
      draft: EMPTY_DRAFT,
    });
  });

  it('rejects with the insert failure, so the write rolls back', async () => {
    const failure = new TemplateNameTakenError();

    mockInsert.mockRejectedValue(failure);

    const [alongside] = alongsideArguments({ enabled: true, name: 'Rent', draft: EMPTY_DRAFT });

    await expect(alongside?.(databaseTransaction)).rejects.toBe(failure);
  });
});
