import { resolveTemplateSwitch } from './save-as-template';

const FORM = { isOn: true, isReadOnly: false, converting: false, isTemplateMode: false };

describe('resolveTemplateSwitch', () => {
  it('shows the switch on a create or a manual edit, and saves the template once it is on', () => {
    expect(resolveTemplateSwitch(FORM)).toEqual({ visible: true, saves: true, nameRequired: true });
    expect(resolveTemplateSwitch({ ...FORM, isOn: false })).toEqual({
      visible: true,
      saves: false,
      nameRequired: false,
    });
  });

  it('hides the switch on a read-only row, and counts it off even when it was on', () => {
    expect(resolveTemplateSwitch({ ...FORM, isReadOnly: true })).toEqual({
      visible: false,
      saves: false,
      nameRequired: false,
    });
  });

  it('hides the switch while converting, and counts it off even when it was on', () => {
    expect(resolveTemplateSwitch({ ...FORM, converting: true })).toEqual({
      visible: false,
      saves: false,
      nameRequired: false,
    });
  });

  it('has no switch in a template mode, which always asks for the name', () => {
    expect(resolveTemplateSwitch({ ...FORM, isOn: false, isTemplateMode: true })).toEqual({
      visible: false,
      saves: false,
      nameRequired: true,
    });
  });
});
