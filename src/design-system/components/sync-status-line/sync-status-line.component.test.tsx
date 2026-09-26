import { render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';
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

  it('shows an invalid message with an xmark glyph', async () => {
    const { getByText, getByLabelText } = await render(
      <SyncStatusLine status={{ kind: 'invalid', message: 'Invalid token' }} />,
    );
    expect(getByText('Invalid token')).toBeTruthy();
    expect(getByLabelText('Icon xmark.circle')).toBeTruthy();
  });

  it('shows a save-error message with an xmark glyph', async () => {
    const { getByText, getByLabelText } = await render(
      <SyncStatusLine status={{ kind: 'saveError', message: 'Could not save token' }} />,
    );
    expect(getByText('Could not save token')).toBeTruthy();
    expect(getByLabelText('Icon xmark.circle')).toBeTruthy();
  });
});
