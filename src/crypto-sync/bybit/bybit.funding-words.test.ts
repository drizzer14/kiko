import { EARN_PRINCIPAL_WORDS, isEarnPrincipal } from './bybit.funding-words';

const PRINCIPAL_TYPE = 'fundingAccountRecordEarn';
const INTEREST_DESCRIPTION = 'fundingAccountRecordFlexSavingInterestDistribution';

describe('isEarnPrincipal', () => {
  it('reads the Earn business type as principal', () => {
    expect(isEarnPrincipal(PRINCIPAL_TYPE, 'fundingAccountRecordFlexSavingStake')).toBe(true);
    expect(isEarnPrincipal(PRINCIPAL_TYPE, '')).toBe(true);
  });

  it('reads the interest description of the Earn type as no principal', () => {
    expect(isEarnPrincipal(PRINCIPAL_TYPE, INTEREST_DESCRIPTION)).toBe(false);
  });

  it('reads a word on no list as no principal, whatever its description', () => {
    expect(isEarnPrincipal('fundingAccountRecordOther', '')).toBe(false);
    expect(isEarnPrincipal('', 'fundingAccountRecordFlexSavingStake')).toBe(false);
    expect(isEarnPrincipal('fundingAccountRecordEarnX', '')).toBe(false);
  });

  it('keeps a closed list of the one principal word and the one interest word', () => {
    expect(EARN_PRINCIPAL_WORDS).toEqual({
      showBusiType: [PRINCIPAL_TYPE],
      interestDescription: [INTEREST_DESCRIPTION],
    });
  });
});
