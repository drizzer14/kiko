// What the "save as a new template" switch means for the form right now. It shows wherever the
// transaction write takes the template along: not on a read-only row (`transactionsRepo.update`
// skips the step for any non-manual source, an import or a wallet row included), not while
// converting, and not in a template mode, which saves a template already. A switch left on before
// the row turned out read-only, or before a convert, counts for nothing then (`saves`), so the
// name check and the write read that one flag. A template mode always asks for the name.
export const resolveTemplateSwitch = (state: {
  isOn: boolean;
  isReadOnly: boolean;
  converting: boolean;
  isTemplateMode: boolean;
}): { visible: boolean; saves: boolean; nameRequired: boolean } => {
  const visible = !(state.isReadOnly || state.converting || state.isTemplateMode);
  const saves = state.isOn && visible;

  return { visible, saves, nameRequired: state.isTemplateMode || saves };
};
