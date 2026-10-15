import { match, P } from 'ts-pattern';
import { minOf } from '@kiko/numbers';
import { useTranslation } from 'react-i18next';
import { useMemo, useRef, useState } from 'react';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { type PreparedRule, prepareRules, validateRule } from '@kiko/categories/category-rules';

import { type DraftConversion, type MatcherDraftError, fromMatcherDrafts } from '../rule-draft';

import type { RefusedRule, UseSaveRuleInput, UseSaveRuleResult } from './use-save-rule.types';

const NO_ROW_ERRORS: ReadonlyMap<number, MatcherDraftError> = new Map();

const refusalOf = (
  conversion: DraftConversion,
  otherRules: readonly PreparedRule[],
  ruleId: string | null,
): RefusedRule | undefined => {
  if (conversion.kind === 'invalid') {
    return undefined;
  }

  const validation = validateRule(conversion.matchers, otherRules, ruleId);

  return match(validation)
    .returnType<RefusedRule | undefined>()
    .with({ kind: 'valid' }, () => undefined)
    .with({ kind: P.union('noMatchers', 'neverMatches', 'duplicate') }, (refused) => refused)
    .exhaustive();
};

/**
 * What Save does in the rule editor, apart from how it looks. A press names what cannot be saved
 * (a row that is not a condition, or a rule that can never match or that another category already
 * has) and stops. Otherwise it asks how many existing transactions the rule would change: none
 * saves at once, some opens the sheet that asks whether to apply the rule to them. The screen
 * leaves only after the rule is stored and, when the sheet was up, once that sheet has closed.
 */
export const useSaveRule = ({
  ruleId,
  categoryKey,
  drafts,
  rules,
  onSaved,
  onRefused,
}: UseSaveRuleInput): UseSaveRuleResult => {
  const { t } = useTranslation();
  const [attempted, setAttempted] = useState(false);
  // The count stays after the sheet hides, so its text holds still while it fades.
  const [sheet, setSheet] = useState({ visible: false, count: 0 });
  const storedRef = useRef(false);
  const conversion = useMemo(() => fromMatcherDrafts(drafts), [drafts]);
  const otherRules = useMemo(() => prepareRules(rules).ordered, [rules]);
  const refusal = refusalOf(conversion, otherRules, ruleId);

  const alertSaveFailed = (): void =>
    alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

  const save = async (): Promise<void> => {
    setAttempted(true);

    if (conversion.kind === 'invalid') {
      onRefused({ kind: 'row', position: minOf([...conversion.errors.keys()]) });

      return;
    }

    if (refusal !== undefined) {
      onRefused({ kind: 'rule' });

      return;
    }

    const rule = { id: ruleId, category: categoryKey, matchers: conversion.matchers };

    try {
      const count = await categoryRulesRepo.countRuleRewrite(rule);

      if (count > 0) {
        setSheet({ visible: true, count });

        return;
      }

      await categoryRulesRepo.saveRule({ ...rule, applyToExisting: false });
      onSaved();
    } catch {
      alertSaveFailed();
    }
  };

  // The sheet stays up until the write is done; the screen leaves from `onClosed`, never from
  // here, because a native-stack screen popped under a closing sheet is a known iOS rough edge.
  const store = async (applyToExisting: boolean): Promise<void> => {
    if (conversion.kind === 'invalid') {
      return;
    }

    try {
      await categoryRulesRepo.saveRule({
        id: ruleId,
        category: categoryKey,
        matchers: conversion.matchers,
        applyToExisting,
      });
      storedRef.current = true;
      setSheet((current) => ({ ...current, visible: false }));
    } catch {
      alertSaveFailed();
    }
  };

  const saveControl = useSubmitOnce(save);
  const apply = useSubmitOnce(() => store(true));
  const keepNew = useSubmitOnce(() => store(false));

  const onDismiss = (): void => {
    if (!apply.isSubmitting && !keepNew.isSubmitting) {
      setSheet((current) => ({ ...current, visible: false }));
    }
  };

  const onClosed = (): void => {
    if (storedRef.current) {
      storedRef.current = false;
      onSaved();
    }
  };

  return {
    errors: {
      rows: attempted && conversion.kind === 'invalid' ? conversion.errors : NO_ROW_ERRORS,
      rule: attempted ? refusal : undefined,
    },
    save: saveControl,
    sheet: { ...sheet, onDismiss, onClosed, apply, keepNew },
  };
};
