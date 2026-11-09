// `RNFS.TemporaryDirectoryPath` is a native constant (`NSTemporaryDirectory()`
// on iOS) whose trailing-slash presence has drifted across OS/library
// versions — a bare concatenation silently produces a malformed path (e.g.
// `/tmp` + `kiko-export-….kiko` with no separator) that `writeFile` then
// fails on, with the failure surfacing only as the generic export error
// Alert. This joins the two unconditionally correctly regardless of whether
// the directory constant already ends in `/`.
export const joinPath = (directory: string, fileName: string): string =>
  `${directory}${directory.endsWith('/') ? '' : '/'}${fileName}`;
