import either from 'fnts/either';
import * as RNFS from 'react-native-fs';

import { joinPath } from '../join-path';

const FILE_PREFIX = 'kiko-transactions-';
const FILE_SUFFIX = '.csv';

// Counts every share still open, across screen mounts: a Duo fold remounts the export screen
// while the share sheet still holds the file, so the count cannot live in a component.
let sharesInFlight = 0;

const isCsvExportName = (name: string): boolean =>
  name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX);

export const writeCsvExport = async (text: string): Promise<string> => {
  const path = joinPath(RNFS.TemporaryDirectoryPath, `${FILE_PREFIX}${Date.now()}${FILE_SUFFIX}`);

  try {
    await RNFS.writeFile(path, text, 'utf8');
  } catch (error) {
    // A write that fails midway leaves the part it wrote: plain text of the user's ledger.
    await either(async () => RNFS.unlink(path));

    throw error;
  }

  return path;
};

// Every failure is folded: a file that is already gone, or a folder that cannot be read, must
// never stop the app from opening or the share from reporting its own outcome.
export const deleteCsvExports = async (): Promise<void> => {
  await either(async () => {
    const entries = await RNFS.readDir(RNFS.TemporaryDirectoryPath);

    await Promise.all(
      entries
        .filter((entry) => isCsvExportName(entry.name))
        .map((entry) => either(async () => RNFS.unlink(entry.path))),
    );
  });
};

export const deleteCsvExportsIfIdle = async (): Promise<void> => {
  if (sharesInFlight === 0) {
    await deleteCsvExports();
  }
};

/**
 * Writes the file and shares it, then deletes it when the share settles, even if the screen that
 * started it has unmounted since. The share counts as open before the write starts, so a screen
 * mounted again while the file is being written cannot delete it as a leftover. The write's or
 * the share's own rejection is passed on after the delete. Leftover files go only once no other
 * share is open.
 */
export const shareCsvExport = async (
  write: () => Promise<string>,
  share: (path: string) => Promise<unknown>,
): Promise<void> => {
  sharesInFlight += 1;

  let path: string | undefined;

  try {
    path = await write();

    await share(path);
  } finally {
    sharesInFlight -= 1;

    const written = path;

    if (written !== undefined) {
      await either(async () => RNFS.unlink(written));
    }

    await deleteCsvExportsIfIdle();
  }
};
