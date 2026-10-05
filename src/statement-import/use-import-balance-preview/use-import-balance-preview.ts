import { useEffect, useState } from 'react';
import type { ImportBalancePreview } from '@kiko/transactions/repo';

import type { ParsedStatement } from '../parser';
import { previewParsedStatementBalance } from '../import-statement';

type Settled = {
  statement: ParsedStatement;
  holdingId: string;
  preview: ImportBalancePreview | undefined;
};

/**
 * What importing `statement` into the picked holding would leave its balance at
 * (`previewParsedStatementBalance`), or `undefined` while there is no holding or
 * statement, while the read is out, or when it cannot be read (a holding the
 * import itself refuses). A result belongs to the statement and holding it was
 * asked for, so a pick or mapping change never shows the old number; and the
 * newest request wins when an older one settles last. Pass a statement that
 * keeps its identity between renders, since a new one is a new request.
 */
export const useImportBalancePreview = (
  statement: ParsedStatement | undefined,
  holdingId: string | undefined,
): ImportBalancePreview | undefined => {
  const [settled, setSettled] = useState<Settled | undefined>(undefined);

  useEffect(() => {
    if (statement === undefined || holdingId === undefined) {
      return;
    }

    let current = true;
    const settle = (preview: ImportBalancePreview | undefined): void => {
      if (current) {
        setSettled({ statement, holdingId, preview });
      }
    };

    previewParsedStatementBalance(statement, holdingId)
      .then(settle)
      .catch(() => settle(undefined));

    return () => {
      current = false;
    };
  }, [statement, holdingId]);

  return settled?.statement === statement && settled?.holdingId === holdingId
    ? settled?.preview
    : undefined;
};
