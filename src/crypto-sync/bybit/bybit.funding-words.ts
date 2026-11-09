/**
 * The closed list of Funding-ledger words that mean principal moving to or from Earn: the
 * `showBusiType` words, and the `description` words that name interest instead, which stays a true
 * credit. A longer list changes a row only when a read returns it, because the parse stores the
 * verdict of this list and never the words.
 */
export const EARN_PRINCIPAL_WORDS = {
  showBusiType: ['fundingAccountRecordEarn'],
  interestDescription: ['fundingAccountRecordFlexSavingInterestDistribution'],
} as const satisfies Record<string, readonly string[]>;

const isListed = (words: readonly string[], word: string): boolean => words.includes(word);

/** Whether the words of one ledger row name a principal move to or from Earn. */
export const isEarnPrincipal = (showBusiType: string, description: string): boolean =>
  isListed(EARN_PRINCIPAL_WORDS.showBusiType, showBusiType) &&
  !isListed(EARN_PRINCIPAL_WORDS.interestDescription, description);
