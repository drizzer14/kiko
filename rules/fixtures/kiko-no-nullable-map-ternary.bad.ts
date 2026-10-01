// Semgrep fixture (POSITIVE): kiko-no-nullable-map-ternary MUST report a
// finding on every pinned line below. Never "fix" this file — see
// kiko-code-style's "Banned: the nullable-map ternary".

type Holding = { nickname: string; category: string | null };

const toTag = (category: string): string => category;
const latestPoint = (meta: string): { day: number } => ({ day: 0 });
const toRow = (value: string): string[] => [value];

export const nicknameLabel = (holding: Holding): string | undefined =>
  // EXPECT-FINDING
  holding.nickname === undefined ? undefined : holding.nickname.trim();

export const categoryTags = (holding: Holding): string[] =>
  // EXPECT-FINDING
  holding.category === null ? [] : [toTag(holding.category)];

export const errorTestID = (testID: string | undefined): string | undefined =>
  // EXPECT-FINDING
  testID !== undefined ? `${testID}-error` : undefined;

export const pointDay = (meta: string | null): { day: number } | null =>
  // EXPECT-FINDING
  meta == null ? null : latestPoint(meta);

export const timeRows = (time: number | null | undefined): { time: number }[] =>
  // EXPECT-FINDING
  time === undefined || time === null ? [] : [{ time }];

export const presentRow = (value: string | null | undefined): string[] =>
  // EXPECT-FINDING
  value !== null && value !== undefined ? toRow(value) : [];

export const looseNicknameLabel = (holding: Holding): string | undefined =>
  // EXPECT-FINDING
  holding.nickname == undefined ? undefined : holding.nickname.trim();

export const looseErrorTestID = (testID: string | undefined): string | undefined =>
  // EXPECT-FINDING
  testID != undefined ? `${testID}-error` : undefined;

export const reversedNicknameLabel = (holding: Holding): string | undefined =>
  // EXPECT-FINDING
  undefined === holding.nickname ? undefined : holding.nickname.trim();

export const nicknamePatch = (nickname: string | undefined): { nickname?: string } => ({
  // EXPECT-FINDING
  ...(nickname === undefined ? {} : { nickname }),
});

export const presentNicknamePatch = (nickname: string | undefined): { nickname?: string } => ({
  // EXPECT-FINDING
  ...(nickname !== undefined ? { nickname } : {}),
});

export const categoryPatch = (category: string | null): { category?: string } => ({
  // EXPECT-FINDING
  ...(category === null ? {} : { category }),
});

export const presentCategoryPatch = (category: string | null): { category?: string } => ({
  // EXPECT-FINDING
  ...(category !== null ? { category } : {}),
});

export const looseCategoryPatch = (category: string | null): { category?: string } => ({
  // EXPECT-FINDING
  ...(category == null ? {} : { category }),
});

export const loosePresentCategoryPatch = (category: string | null): { category?: string } => ({
  // EXPECT-FINDING
  ...(category != null ? { category } : {}),
});

export const looseUndefinedCategoryPatch = (category: string | null): { category?: string } => ({
  // EXPECT-FINDING
  ...(category == undefined ? {} : { category }),
});

export const loosePresentUndefinedCategoryPatch = (
  category: string | null,
): { category?: string } => ({
  // EXPECT-FINDING
  ...(category != undefined ? { category } : {}),
});

export const longhandTimePatch = (time: number | null | undefined): { time?: number } => ({
  // EXPECT-FINDING
  ...(time === undefined || time === null ? {} : { time }),
});

export const longhandPresentTimePatch = (time: number | null | undefined): { time?: number } => ({
  // EXPECT-FINDING
  ...(time !== null && time !== undefined ? { time } : {}),
});

export const balancePatch = (balance: number | undefined): { balance?: number } =>
  // EXPECT-FINDING
  balance === undefined ? {} : { balance };
