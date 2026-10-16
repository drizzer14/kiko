// Semgrep fixture (NEGATIVE): `sortEnabled` is the freshness gate alone, so a lone card lifts like
// any other, and a length check anywhere else is no grid gate. `kiko-sortable-grid-lone-card-lifts`
// must draw ZERO findings from this file.
type GridProps = { data: unknown[]; sortEnabled: boolean; renderItem: () => null };

const Sortable = { Grid: (_props: GridProps) => null };

const cards: unknown[] = [];
const cardsFresh = true;
const renderCard = () => null;

export const freshnessAlone = (
  <Sortable.Grid data={cards} sortEnabled={cardsFresh} renderItem={renderCard} />
);

export const freshnessAndReadiness = (
  <Sortable.Grid
    data={cards}
    sortEnabled={cardsFresh && cards.length > 0}
    renderItem={renderCard}
  />
);

export const lengthOnAnotherProp = (
  <Sortable.Grid
    data={cards.length > 1 ? cards : []}
    sortEnabled={cardsFresh}
    renderItem={renderCard}
  />
);

export const lengthOutsideAnyGrid = cards.length > 1;
