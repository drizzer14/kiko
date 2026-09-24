import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { exportedComponentNames } from './one-component-per-file';

// kiko-code-style's "One component per file" — define exactly one React
// component per file. This walks every real `.tsx` file under `src/` (app
// code AND shared test helpers, per the brief) and asserts none of them
// exports 2+ components. The real splits this would otherwise force
// (LoanFormBlock, StatementPreviewBlock, StatementImportFooter,
// ColumnMappingForm) are a separate task — this test only adds the
// invariant, so it must currently find ZERO violations.
const SRC_ROOT = join(__dirname, '../..');

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

  describe('the real src/ tree', () => {
    it('has no .tsx file exporting 2 or more components', () => {
      const violations = tsxFiles(SRC_ROOT)
        .map((file) => ({ file, names: exportedComponentNames(readFileSync(file, 'utf8')) }))
        .filter(({ names }) => names.length >= 2);

      expect(violations).toEqual([]);
    });
  });
});
