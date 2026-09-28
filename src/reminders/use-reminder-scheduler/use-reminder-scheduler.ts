import { i18n } from '@kiko/i18n/init';
import { useEffect, useState } from 'react';
import either, { bifold, isLeft } from 'fnts/either';
import { syncReminders } from '@kiko/reminders/scheduler';
import { AppState, type AppStateStatus } from 'react-native';

// Background too, so smart skip sees the newest data before the app sleeps.
const REPLAN_STATES: readonly AppStateStatus[] = ['active', 'background'];

const warnReplanFailure = (reason: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a failed reminder re-plan has no UI surface; log it so a device log shows what failed, and the next trigger re-plans again
  console.warn('[reminders] re-plan failed', reason);
};

// Never rejects: a native or database failure must not crash the app.
const replan = async (): Promise<void> => {
  const result = await either<unknown, unknown>(() => syncReminders(i18n.t));

  if (isLeft(result)) {
    warnReplanFailure(bifold(result));
  }
};

// One re-plan at a time. A trigger during a run queues a single follow-up,
// which plans from the newest data; more triggers add nothing.
const singleFlight = (task: () => Promise<void>): (() => void) => {
  let running = false;
  let queued = false;

  const trigger = (): void => {
    if (running) {
      queued = true;

      return;
    }

    running = true;
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) the only task is replan, which captures every rejection with either()
    task().then(() => {
      running = false;

      if (queued) {
        queued = false;
        trigger();
      }
    });
  };

  return trigger;
};

/**
 * Keeps the pending reminder notifications in step with the data: re-plans on
 * mount, when the app becomes active or goes to the background, and when the
 * language changes. Mounted in `AppRoot`, below `MigrationsGate` and
 * `LockGate`, so it runs after migrations and after unlock. React runs a
 * parent's effects after its children's, so the first screen's reads are
 * already queued on op-sqlite's one worker ahead of this sync's `LIMIT 1` gate.
 */
export const useReminderScheduler = (): void => {
  const [trigger] = useState(() => singleFlight(replan));

  useEffect(() => {
    trigger();
  }, [trigger]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (REPLAN_STATES.includes(state)) {
        trigger();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [trigger]);

  useEffect(() => {
    i18n.on('languageChanged', trigger);

    return () => {
      i18n.off('languageChanged', trigger);
    };
  }, [trigger]);
};
