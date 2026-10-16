// Semgrep fixture (POSITIVE): kiko-gestures' "A lone card lifts too" makes `sortEnabled` the
// query's freshness gate alone. `kiko-sortable-grid-lone-card-lifts` MUST report a finding on
// each pinned line below: a `Sortable.Grid` whose `sortEnabled` also asks for more than one item,
// wherever in an `&&` chain the count sits, and `1 < n` and `2 <= n` as well (Semgrep reports
// parenthesized JSX at the line of the opening parenthesis).
type GridProps = { data: unknown[]; sortEnabled: boolean; renderItem: () => null };

const Sortable = { Grid: (_props: GridProps) => null };

const cards: unknown[] = [];
const cardsFresh = true;
const cardsReady = true;
const holder = { items: cards };
const renderCard = () => null;

// EXPECT-FINDING
export const countAfterFreshness = (
  <Sortable.Grid
    data={cards}
    sortEnabled={cardsFresh && cards.length > 1}
    renderItem={renderCard}
  />
);

// EXPECT-FINDING
export const countBeforeFreshness = (
  <Sortable.Grid
    data={cards}
    sortEnabled={cards.length > 1 && cardsFresh}
    renderItem={renderCard}
  />
);

// EXPECT-FINDING
export const countAlone = (
  <Sortable.Grid data={cards} sortEnabled={cards.length > 1} renderItem={renderCard} />
);

// EXPECT-FINDING
export const atLeastTwo = (
  <Sortable.Grid data={cards} sortEnabled={cards.length >= 2} renderItem={renderCard} />
);

// EXPECT-FINDING
export const memberCount = (
  <Sortable.Grid
    data={cards}
    sortEnabled={cardsFresh && holder.items.length > 1}
    renderItem={renderCard}
  />
);

// EXPECT-FINDING
export const countBetweenTwoGates = (
  <Sortable.Grid
    data={cards}
    sortEnabled={cardsFresh && cards.length > 1 && cardsReady}
    renderItem={renderCard}
  />
);

// EXPECT-FINDING
export const yodaCount = (
  <Sortable.Grid data={cards} sortEnabled={1 < cards.length} renderItem={renderCard} />
);

// EXPECT-FINDING
export const yodaAtLeastTwo = (
  <Sortable.Grid data={cards} sortEnabled={2 <= cards.length} renderItem={renderCard} />
);
