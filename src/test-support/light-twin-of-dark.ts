import { type SwatchName, entityColorsDark, entityColorsLight } from '@kiko/design-system/palette';

export const lightTwinOfDark: Record<string, string> = Object.fromEntries(
  (Object.keys(entityColorsDark) as SwatchName[]).map((name) => [
    entityColorsDark[name],
    entityColorsLight[name],
  ]),
);
