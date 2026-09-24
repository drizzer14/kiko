// EXPECT-FINDING
const label = holding.nickname === undefined ? undefined : holding.nickname.trim();

// EXPECT-FINDING
const tags = holding.category === null ? [] : [toTag(holding.category)];

// EXPECT-FINDING
const suffix = testID !== undefined ? `${testID}-error` : undefined;

// EXPECT-FINDING
const point = meta == null ? null : latestPoint(meta);

// EXPECT-FINDING
const day = time === undefined || time === null ? [] : [{ time }];

// EXPECT-FINDING
const row = value !== null && value !== undefined ? toRow(value) : [];
