export type ReadOnlyNoticeProps = {
  isReadOnly: boolean;
  // A catalog-resolved string, passed in rather than read from a module-level
  // constant, so the component stays translation-agnostic.
  noticeText: string;
};
