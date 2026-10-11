import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import SegmentedControl from '@kiko/design-system/components/segmented-control';

import TemplateSelect from '../template-select';

import { ENTRY_TABS, type EntryTab } from './entry-tabs';
import type { EntryTabsProps } from './entry-tabs.props';

// The Manual and Template tabs above the form. Each tab shows different fields (the Template tab
// shows the picker, and holds the form back until a template is picked), which is the tabs case of
// the tabs-vs-chips rule. Switching tabs only shows or hides: the form's values live in the screen,
// so none is lost. Returns the bare children where the entry has no tabs, so the screen renders
// this unconditionally and spends no branch of its own on it.
const EntryTabs = ({
  visible,
  tab,
  onSelectTab,
  awaitsPick,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  children,
}: EntryTabsProps): ReactElement => {
  const { t } = useTranslation();

  if (!visible) {
    return <>{children}</>;
  }

  const labels: Record<EntryTab, string> = {
    manual: t('forms.transaction.tabManual'),
    template: t('forms.transaction.tabTemplate'),
  };

  return (
    <>
      <SegmentedControl<EntryTab>
        options={ENTRY_TABS}
        selected={tab}
        onSelect={onSelectTab}
        labels={labels}
        accessibilityLabel={t('forms.transaction.entryModeLabel')}
        testID="entry-tabs"
      />

      {tab === 'template' ? (
        <TemplateSelect
          templates={templates}
          selectedId={selectedTemplateId}
          onSelect={onSelectTemplate}
        />
      ) : null}

      {awaitsPick ? null : children}
    </>
  );
};

export default EntryTabs;
