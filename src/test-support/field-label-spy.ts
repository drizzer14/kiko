import type { ComponentProps } from 'react';
import type FieldLabel from '@kiko/design-system/components/field-label';

type FieldLabelProps = ComponentProps<typeof FieldLabel>;

// FieldLabel's red tint is a react-native-unistyles variant that the Jest mock
// strips, so a test cannot read it off the rendered caption. A test file mocks
// FieldLabel with this module: it renders the real FieldLabel unchanged and
// hands every render's props to `record`, so `isLabelInvalid` can tell which
// labels turned red.
export const fieldLabelSpyModule = (record: (props: FieldLabelProps) => void) => {
  const { default: RealFieldLabel } = jest.requireActual<{ default: typeof FieldLabel }>(
    '@kiko/design-system/components/field-label',
  );

  return {
    __esModule: true,
    default: (props: FieldLabelProps): ReturnType<typeof FieldLabel> => {
      record(props);

      return RealFieldLabel(props);
    },
  };
};

// Whether the latest render of the label reading `label` was invalid.
export const isLabelInvalid = (spy: jest.Mock, label: string): boolean =>
  spy.mock.calls.filter(([props]) => props.label === label).at(-1)?.[0].invalid === true;
