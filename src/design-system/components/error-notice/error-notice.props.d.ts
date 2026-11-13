type ErrorNoticeLine = { key: string; text: string; testID?: string };

type ErrorNoticeBase = {
  // Speak the text to VoiceOver when the notice mounts or its text changes. Default true.
  announce?: boolean;
  testID?: string;
};

export type ErrorNoticeProps = ErrorNoticeBase &
  (
    | { message: string; lines?: never }
    // A list of messages in ONE tinted block (the column-mapping row errors), never one block
    // per row.
    | { lines: ReadonlyArray<ErrorNoticeLine>; message?: never }
  );
