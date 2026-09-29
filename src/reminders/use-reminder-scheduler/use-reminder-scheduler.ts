import { useEffect } from 'react';
import { i18n } from '@kiko/i18n/init';
import either, { bifold, isLeft } from 'fnts/either';
import { AppState, type AppStateStatus } from 'react-native';
import { routeLatestResponse } from '@kiko/reminders/routing';
import { navigationRef } from '@kiko/navigation/navigation-ref';
import { drainReminderResponses, syncReminders } from '@kiko/reminders/scheduler';
import { type NotificationResponse, remindersNative } from '@kiko/reminders/native';

// Background too, so smart skip sees the newest data before the app sleeps.
const REPLAN_STATES: readonly AppStateStatus[] = ['active', 'background'];

export const warnReplanFailure = (reason: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a failed reminder re-plan has no UI surface; log it so a device log shows what failed, and the next trigger re-plans again
  console.warn('[reminders] re-plan failed', reason);
};

const warnOnFailure = async (task: () => Promise<void>): Promise<void> => {
  const result = await either<unknown, void>(async () => task());

  if (isLeft(result)) {
    warnReplanFailure(bifold(result));
  }
};

// Never rejects: a native or database failure must not crash the app. The
// drain is the one reader of the native response queue, so the taps it took
// are routed from here, whatever triggered it, and even when the plan fails:
// the queue no longer holds them. A failed drain plans nothing, because the
// plan's ignored count must see the taps first.
const replan = async (): Promise<void> => {
  const drained = await either<unknown, NotificationResponse[]>(async () =>
    drainReminderResponses(),
  );

  if (isLeft(drained)) {
    warnReplanFailure(bifold(drained));

    return;
  }

  const responses: NotificationResponse[] = bifold(drained);

  await warnOnFailure(() => syncReminders(i18n.t));
  await warnOnFailure(() => routeLatestResponse(responses, navigationRef));
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
 * Re-plans after a reminder write. It shares the scheduler's one queue, so it
 * never runs beside a re-plan an app-state change started, whose older data
 * could otherwise replace the newer plan. Never rejects.
 */
export const replanReminders = singleFlight(replan);

/**
 * Keeps the pending reminder notifications in step with the data: re-plans on
 * mount, when the app becomes active or goes to the background, when the
 * language changes, and when a notification is answered while the app runs.
 * Each re-plan routes the latest notification tap it drained. Mounted in
 * `AppRoot`, below `MigrationsGate` and `LockGate`, so it runs after
 * migrations and after unlock. React runs a parent's effects after its
 * children's, so the first screen's reads are already queued on op-sqlite's
 * one worker ahead of this sync's `LIMIT 1` gate.
 */
export const useReminderScheduler = (): void => {
  useEffect(() => {
    replanReminders();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (REPLAN_STATES.includes(state)) {
        replanReminders();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    i18n.on('languageChanged', replanReminders);

    return () => {
      i18n.off('languageChanged', replanReminders);
    };
  }, []);

  // A tap on a warm app can land after the `active` re-plan has drained the
  // queue; this re-plan drains it.
  useEffect(() => {
    const subscription = remindersNative.onResponse(replanReminders);

    return () => {
      subscription.remove();
    };
  }, []);
};
