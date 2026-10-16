import { isTemplateNameTaken, templateNameKey } from './template-name';

const templates = [
  { id: 'a', name: 'Оренда' },
  { id: 'b', name: 'Coffee' },
];

describe('templateNameKey', () => {
  it('folds Cyrillic case and surrounding spaces to one key', () => {
    expect(templateNameKey(' Оренда ')).toBe(templateNameKey('оренда'));
  });

  it('lowercases and trims', () => {
    expect(templateNameKey('  Morning COFFEE ')).toBe('morning coffee');
  });

  it('keeps inner spaces', () => {
    expect(templateNameKey('a  b')).toBe('a  b');
  });

  it('gives an empty key for a blank name', () => {
    expect(templateNameKey('   ')).toBe('');
  });
});

describe('isTemplateNameTaken', () => {
  it('is false for an empty list', () => {
    expect(isTemplateNameTaken('Coffee', [], null)).toBe(false);
  });

  it('matches an exact name', () => {
    expect(isTemplateNameTaken('Coffee', templates, null)).toBe(true);
  });

  it('ignores case', () => {
    expect(isTemplateNameTaken('cOFFEE', templates, null)).toBe(true);
  });

  it('ignores case in Cyrillic', () => {
    expect(isTemplateNameTaken('оренда', templates, null)).toBe(true);
  });

  it('ignores surrounding spaces', () => {
    expect(isTemplateNameTaken('  Coffee ', templates, null)).toBe(true);
  });

  it('is false for a different name', () => {
    expect(isTemplateNameTaken('Tea', templates, null)).toBe(false);
  });

  it('excludes the template being edited', () => {
    expect(isTemplateNameTaken('coffee', templates, 'b')).toBe(false);
  });

  it('still finds another template with the same name when one is excluded', () => {
    const duplicated = [...templates, { id: 'c', name: 'COFFEE' }];

    expect(isTemplateNameTaken('coffee', duplicated, 'b')).toBe(true);
  });

  it('does not exclude another id', () => {
    expect(isTemplateNameTaken('coffee', templates, 'a')).toBe(true);
  });
});
