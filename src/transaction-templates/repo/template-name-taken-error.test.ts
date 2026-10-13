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

  it('carries its own name so a caller can tell it apart from a plain Error', () => {
    expect((thrown() as Error).name).toBe('TemplateNameTakenError');
  });

  it('explains that another template already uses the name', () => {
    expect((thrown() as Error).message).toBe('Another template already has this name');
  });
});
