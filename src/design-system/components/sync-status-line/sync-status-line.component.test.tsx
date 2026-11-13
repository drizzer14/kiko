import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import SyncStatusLine from './sync-status-line.component';

describe('SyncStatusLine', () => {
  it('renders nothing while idle', async () => {
    const { toJSON } = await render(<SyncStatusLine status={{ kind: 'idle' }} />);
    expect(toJSON()).toBeNull();
  });

  it('shows a Checking… line while checking', async () => {
    const { getByText } = await render(<SyncStatusLine status={{ kind: 'checking' }} />);
    expect(getByText(/Checking/)).toBeTruthy();
  });

  it('shows the success message with a checkmark glyph', async () => {
    const { getByText, getByLabelText } = await render(
      <SyncStatusLine status={{ kind: 'success', message: 'Connected as Jane Doe' }} />,
    );
    expect(getByText('Connected as Jane Doe')).toBeTruthy();
    expect(getByLabelText('Icon checkmark.circle')).toBeTruthy();
  });

  it('renders nothing for an invalid or saveError status: the field shows it as an ErrorNotice', async () => {
    const invalid = await render(
      <SyncStatusLine status={{ kind: 'invalid', message: 'Invalid token' }} />,
    );
    expect(invalid.toJSON()).toBeNull();

    const saveError = await render(
      <SyncStatusLine status={{ kind: 'saveError', message: 'Could not save token' }} />,
    );
    expect(saveError.toJSON()).toBeNull();
  });
});
