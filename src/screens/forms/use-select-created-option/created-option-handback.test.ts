import { closeHandback, handBackCreatedOption, openHandback } from './created-option-handback';

describe('created-option handback', () => {
  it('hands back the option id stored for an open handback, once', () => {
    const handbackId = openHandback();

    handBackCreatedOption(handbackId, 'template-rent');

    expect(closeHandback(handbackId)).toBe('template-rent');
    expect(closeHandback(handbackId)).toBeUndefined();
  });

  it('drops a hand-back for a handback id that was never opened', () => {
    handBackCreatedOption('created-option-never-opened', 'template-rent');

    expect(closeHandback('created-option-never-opened')).toBeUndefined();
  });

  it('drops a hand-back after the handback was closed', () => {
    const handbackId = openHandback();

    closeHandback(handbackId);
    handBackCreatedOption(handbackId, 'template-rent');

    expect(closeHandback(handbackId)).toBeUndefined();
  });

  it('drops a hand-back with no handback id', () => {
    const handbackId = openHandback();

    handBackCreatedOption(undefined, 'template-rent');

    expect(closeHandback(handbackId)).toBeUndefined();
  });

  it('reads nothing for an open handback that got no option, which is a cancel', () => {
    const handbackId = openHandback();

    expect(closeHandback(handbackId)).toBeUndefined();
  });

  it('opens a distinct handback id on every open', () => {
    const first = openHandback();
    const second = openHandback();

    handBackCreatedOption(second, 'template-rent');

    expect(second).not.toBe(first);
    expect(closeHandback(first)).toBeUndefined();
    expect(closeHandback(second)).toBe('template-rent');
  });
});
