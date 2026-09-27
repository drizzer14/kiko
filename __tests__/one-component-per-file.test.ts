import { join } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';

import { exportedComponentNames } from '../scripts/checks/one-component-per-file';

// kiko-code-style's "One component per file" — define exactly one React
// component per file. This walks every real `.tsx` file under `src/` (app
// code and shared test helpers alike) and asserts none of them exports 2+
// components. The scanner itself lives under scripts/checks/, not src/ — a
// harness rule, not app code — and is excluded from Stryker's mutate set
// there (stryker.conf.json) the same way the other checks are (`import-
// order.js`, `kill-guard.js`, `full-word-identifiers.js` are already exempt
// by extension, being plain `.js`; this one is `.ts`, so it needs its own
// exclusion entry).
const SRC_ROOT = join(__dirname, '../src');

const tsxFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      return tsxFiles(full);
    }

    return full.endsWith('.tsx') ? [full] : [];
  });

describe('exportedComponentNames', () => {
  it('finds both names in a file exporting two components (POSITIVE)', () => {
    const source = `
import type { FC } from 'react';

export const First: FC = () => {
  return <View />;
};

export const Second: FC = () => {
  return <View />;
};
`;

    expect(exportedComponentNames(source)).toEqual(['First', 'Second']);
  });

  it('ignores a small local non-exported component (NEGATIVE)', () => {
    const source = `
import type { FC } from 'react';

const LocalRow = ({ label }: { label: string }) => <Text>{label}</Text>;

export const Parent: FC = () => {
  return (
    <View>
      <LocalRow label="a" />
    </View>
  );
};
`;

    expect(exportedComponentNames(source)).toEqual(['Parent']);
  });

  it('resolves the indirect two-step default-export form to one name', () => {
    const source = `
const HoldingCard = (props: Props) => {
  return <View />;
};

export default HoldingCard;
`;

    expect(exportedComponentNames(source)).toEqual(['HoldingCard']);
  });

  it('does not count an exported non-component constant', () => {
    const source = `
export const MAX_ROWS = 5;

export const Table = () => {
  return <View />;
};
`;

    expect(exportedComponentNames(source)).toEqual(['Table']);
  });

  it('exempts an inline mock component defined inside a jest.mock factory body', () => {
    const source = `
jest.mock('../../design-system/components/symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <RNText>{\`icon:\${name}\`}</RNText>,
  };
});

export const RealComponent = () => {
  return <View />;
};
`;

    expect(exportedComponentNames(source)).toEqual(['RealComponent']);
  });

  it('finds a concise arrow-body component (implicit return)', () => {
    const source = `
const MockTextTone = ({ tone }: { tone: string }) => <RNText>{tone}</RNText>;

export default MockTextTone;
`;

    expect(exportedComponentNames(source)).toEqual(['MockTextTone']);
  });

  it('resolves a memo-wrapped default export to the wrapped component name', () => {
    const source = `
const PieChart = (props: Props) => {
  return <View />;
};

export default memo(PieChart);
`;

    expect(exportedComponentNames(source)).toEqual(['PieChart']);
  });

  it('finds a component exported through a named export list', () => {
    const source = `
const First = () => {
  return <View />;
};

export { First };
`;

    expect(exportedComponentNames(source)).toEqual(['First']);
  });

  it('finds both names in a named export list exporting two components', () => {
    const source = `
const First = () => {
  return <View />;
};

const Second = () => {
  return <View />;
};

export { First, Second };
`;

    expect(exportedComponentNames(source)).toEqual(['First', 'Second']);
  });

  it('does not mistake a re-export list (with a from clause) for a local declaration', () => {
    const source = `
export { FILTER_ALL } from '../filter-menu';

export const Table = () => {
  return <View />;
};
`;

    expect(exportedComponentNames(source)).toEqual(['Table']);
  });

  it('does not blank the rest of the file on an apostrophe inside JSX text', () => {
    const source = `
export const First = () => {
  return <Text>Don't do that</Text>;
};

export const Second = () => {
  return <View />;
};
`;

    expect(exportedComponentNames(source)).toEqual(['First', 'Second']);
  });

  it('does not blank the rest of the file on a quote inside a regex literal', () => {
    const source = `
const stripQuote = (value: string) => value.replace(/'/g, '');

export const First = () => {
  return <View />;
};

export const Second = () => {
  return <View />;
};
`;

    expect(exportedComponentNames(source)).toEqual(['First', 'Second']);
  });

  describe('the real src/ tree', () => {
    it('has no .tsx file exporting 2 or more components', () => {
      const violations = tsxFiles(SRC_ROOT)
        .map((file) => ({ file, names: exportedComponentNames(readFileSync(file, 'utf8')) }))
        .filter(({ names }) => names.length >= 2);

      expect(violations).toEqual([]);
    });
  });
});
