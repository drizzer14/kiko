import { useCallback, useEffect, useRef } from 'react';

/**
 * A function that answers whether the component is still mounted, for an async handler to ask
 * after an await. It reads a ref, so a handler that started before an unmount still gets the
 * current answer, and its identity never changes.
 */
export const useIsMounted = (): (() => boolean) => {
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  return useCallback(() => isMounted.current, []);
};
