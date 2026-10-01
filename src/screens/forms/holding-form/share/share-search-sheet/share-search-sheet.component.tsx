import { match, P } from 'ts-pattern';
import { useTranslation } from 'react-i18next';
import { FlatList, Keyboard } from 'react-native';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import { type FC, useEffect, useRef, useState } from 'react';
import TextField from '@kiko/design-system/components/text-field';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import SelectableRow from '@kiko/design-system/components/selectable-row';
import type { ShareListing, ShareSearchResult } from '@kiko/prices/share-search';

import { styles } from './share-search-sheet.styles';
import type { ShareSearchSheetProps } from './share-search-sheet.props';

type MessageKey =
  | 'forms.holding.shareFindEmpty'
  | 'forms.holding.shareFindUnavailable'
  | 'forms.holding.shareFindQuotaExhausted';

type SearchPhase =
  | { kind: 'idle' }
  | { kind: 'found'; listings: ShareListing[] }
  | { kind: 'message'; key: MessageKey };

const IDLE: SearchPhase = { kind: 'idle' };

const phaseOf = (result: ShareSearchResult): SearchPhase =>
  match(result)
    .returnType<SearchPhase>()
    .with({ status: 'ok', listings: [] }, () => ({
      kind: 'message',
      key: 'forms.holding.shareFindEmpty',
    }))
    .with({ status: 'ok' }, ({ listings }) => ({ kind: 'found', listings }))
    .with({ status: 'quotaExhausted' }, () => ({
      kind: 'message',
      key: 'forms.holding.shareFindQuotaExhausted',
    }))
    .with({ status: P.union('noKey', 'failed') }, () => ({
      kind: 'message',
      key: 'forms.holding.shareFindUnavailable',
    }))
    .exhaustive();

// The share form's EODHD search: a query field and an explicit Search button,
// then the listings found. Every failure ends in a caption that points back to
// typing the ticker, which the form's own field always allows.
const ShareSearchSheet: FC<ShareSearchSheetProps> = ({ visible, onDismiss, search, onPick }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<SearchPhase>(IDLE);
  // Each search and each close takes a new number, so an answer that arrives
  // after the sheet closed or after a newer search is dropped.
  const latestRequest = useRef(0);

  useEffect(() => {
    if (!visible) {
      latestRequest.current += 1;
      setQuery('');
      setPhase(IDLE);
    }
  }, [visible]);

  const runSearch = async (): Promise<void> => {
    const trimmed = query.trim();

    if (trimmed === '') {
      return;
    }

    Keyboard.dismiss();
    latestRequest.current += 1;
    // The previous results must not stay tappable under a new query.
    setPhase(IDLE);

    const request = latestRequest.current;
    const result = await search(trimmed).catch((): ShareSearchResult => ({ status: 'failed' }));

    if (request === latestRequest.current) {
      setPhase(phaseOf(result));
    }
  };

  // Every search spends one of the user's daily EODHD calls, so a double tap
  // must not start a second one.
  const { onPress: handleSearch, isSubmitting: isSearching } = useSubmitOnce(runSearch);

  const handlePick = (listing: ShareListing): void => {
    Keyboard.dismiss();
    onPick(listing);
    onDismiss();
  };

  const handleDismiss = (): void => {
    Keyboard.dismiss();
    onDismiss();
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={handleDismiss}
      gap={3}
      scrollable={false}
      header={<Text variant="heading">{t('forms.holding.shareFindSheetTitle')}</Text>}
      testID="share-search-sheet"
      backdropTestID="share-search-sheet-backdrop"
    >
      <TextField
        label={t('forms.holding.shareFindQuery')}
        value={query}
        onChangeText={setQuery}
        placeholder={t('forms.holding.shareFindPlaceholder')}
        leadingIcon="magnifyingglass"
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <Button onPress={handleSearch} loading={isSearching} testID="share-search-submit">
        {t('forms.holding.shareFindSubmit')}
      </Button>

      {match(phase)
        .with({ kind: 'message' }, ({ key }) => (
          <Text variant="caption" tone="textSecondary">
            {t(key)}
          </Text>
        ))
        .with({ kind: 'found' }, ({ listings }) => (
          <FlatList
            data={listings}
            keyExtractor={(listing) => listing.symbol}
            renderItem={({ item: listing }) => (
              <SelectableRow
                testID={`share-search-option-${listing.symbol}`}
                accessibilityRole="button"
                accessibilityLabel={`${listing.name} ${listing.symbol}`}
                selected={false}
                onPress={() => handlePick(listing)}
                label={listing.name}
                description={
                  <Text variant="caption" tone="textSecondary">
                    {`${listing.symbol} · ${listing.quoteCurrency}`}
                  </Text>
                }
              />
            )}
            showsVerticalScrollIndicator={false}
            // The query field above can keep the keyboard up; "handled" lets
            // the first tap on a row pick it instead of only dismissing the
            // keyboard.
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}
            testID="share-search-results"
          />
        ))
        .with({ kind: 'idle' }, () => null)
        .exhaustive()}
    </BottomSheet>
  );
};

export default ShareSearchSheet;
