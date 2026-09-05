import { isValidBitcoinAddress } from './bitcoin-address';

describe('isValidBitcoinAddress', () => {
  it.each([
    ['legacy P2PKH', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ['P2SH', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
    ['bech32 P2WPKH', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['bech32m P2TR', 'bc1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sspknck9'],
  ])('accepts a %s mainnet address', (_label, address) => {
    expect(isValidBitcoinAddress(address)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['testnet bech32', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'],
    ['bad leading char', '0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ['mixed-case bech32', 'bc1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ'],
    ['non-base58 char', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa!'],
    ['bech32 with a leading char before bc1', 'xbc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['bech32 with trailing garbage', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq!!'],
    ['too short', '1abc'],
    ['free text', 'not an address'],
  ])('rejects %s', (_label, address) => {
    expect(isValidBitcoinAddress(address)).toBe(false);
  });
});
