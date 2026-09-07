const mockWriteSnapshot = jest.fn(() => Promise.resolve());
const mockReloadWidget = jest.fn();

describe('widgetBridge', () => {
  afterEach(() => jest.resetModules());

  it('serializes the snapshot to JSON and calls the native writeSnapshot', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        WidgetBridge: { writeSnapshot: mockWriteSnapshot, reloadWidget: mockReloadWidget },
      },
    }));
    const { widgetBridge } = require('./widget-bridge');
    const snapshot = {
      baseCurrency: 'UAH',
      total: { formatted: '₴0.00', minorUnits: 0 },
      breakdown: [],
      updatedAt: 1,
    };

    await widgetBridge.writeSnapshot(snapshot);

    expect(mockWriteSnapshot).toHaveBeenCalledWith(JSON.stringify(snapshot));
  });

  it('does not throw when the native module is absent', async () => {
    jest.doMock('react-native', () => ({ NativeModules: {} }));
    const { widgetBridge } = require('./widget-bridge');

    await expect(
      widgetBridge.writeSnapshot({
        baseCurrency: 'UAH',
        total: { formatted: '', minorUnits: 0 },
        breakdown: [],
        updatedAt: 1,
      }),
    ).resolves.toBeUndefined();
    expect(() => widgetBridge.reloadWidget()).not.toThrow();
  });

  it('calls the native clearSnapshot', async () => {
    const mockClearSnapshot = jest.fn(() => Promise.resolve());
    jest.doMock('react-native', () => ({
      NativeModules: {
        WidgetBridge: {
          writeSnapshot: mockWriteSnapshot,
          clearSnapshot: mockClearSnapshot,
          reloadWidget: mockReloadWidget,
        },
      },
    }));
    const { widgetBridge } = require('./widget-bridge');

    await widgetBridge.clearSnapshot();

    expect(mockClearSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not throw on clearSnapshot when the native module is absent', async () => {
    jest.doMock('react-native', () => ({ NativeModules: {} }));
    const { widgetBridge } = require('./widget-bridge');

    await expect(widgetBridge.clearSnapshot()).resolves.toBeUndefined();
  });
});
