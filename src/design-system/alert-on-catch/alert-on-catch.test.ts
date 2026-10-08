import { Alert } from 'react-native';
import type { TFunction } from 'i18next';

import { alertOnCatch } from './alert-on-catch';

const fakeT = ((key: string) => key) as TFunction;

describe('alertOnCatch', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows a translated Alert with the given title and message keys', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    alertOnCatch(fakeT, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

    expect(alertSpy).toHaveBeenCalledWith(
      'forms.fields.saveErrorTitle',
      'forms.fields.saveErrorMessage',
    );
  });
});
