// Semgrep fixture (POSITIVE): kiko-gestures' "A lone card lifts too" makes `sortEnabled` the
// query's freshness gate alone. `kiko-sortable-grid-lone-card-lifts` MUST report a finding on
// each pinned line below: a `Sortable.Grid` whose `sortEnabled` also asks for more than one item,
// whichever side of the `&&` the count sits on (Semgrep reports parenthesized JSX at the line of
// the opening parenthesis).
type GridProps = { data: unknown[]; sortEnabled: boolean; renderItem: () => null };

const Sortable = { Grid: (_props: GridProps) => null };

const cards: unknown[] = [];
const cardsFresh = true;
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
