export const mockClearCredentials = jest.fn(async (_id: string) => {});
export const mockClearBybitCredentials = jest.fn(async (_id: string) => {});

export const binanceCredentialsModule = () => ({
  clearCredentials: (id: string) => mockClearCredentials(id),
});

export const bybitCredentialsModule = () => ({
  clearBybitCredentials: (id: string) => mockClearBybitCredentials(id),
});
