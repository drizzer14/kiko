import { TemplateNameTakenError } from './template-name-taken-error';

describe('TemplateNameTakenError', () => {
  const thrown = (): unknown => {
    try {
      throw new TemplateNameTakenError();
    } catch (caught) {
      return caught;
    }
  };

  it('is both a TemplateNameTakenError and an Error', () => {
    expect(thrown()).toBeInstanceOf(TemplateNameTakenError);
    expect(thrown()).toBeInstanceOf(Error);
  });

  it('carries its own name and explains that another template already uses it', () => {
    const error = thrown() as Error;

    expect(error.name).toBe('TemplateNameTakenError');
    expect(error.message).toBe('Another template already has this name');
  });
});
