// Ambient types for the deep import `react-native/Libraries/Share/Share`.
// `export-data.screen.tsx` imports this internal path directly (rather than
// `Share` off the `react-native` package root) because its own test mocks
// this exact module path with a plain `{ share: fn }` object — RN's own
// index re-exports `Share` via `require('./Libraries/Share/Share').default`,
// which the test's mock (no `default` key) leaves undefined. React Native
// ships a real `.d.ts` alongside the deep path
// (`node_modules/react-native/Libraries/Share/Share.d.ts`), but `react-native`'s
// `package.json` `"exports"` map only exposes the package root `"."`, not
// `"./Libraries/*"`, so under this project's `"moduleResolution": "bundler"`
// TypeScript refuses to resolve the deep import's own types (TS2307) even
// though the file exists on disk — the same class of gap as
// `src/statement-import/windows-1251.d.ts`. Re-declared here to match the
// real module's runtime shape (a default-exported object with a `share`
// method), not the shipped `.d.ts`'s own named-export shape, since Share.js's
// actual source is `export default Share;`.
declare module 'react-native/Libraries/Share/Share' {
  export type ShareContent =
    | { title?: string; url: string; message?: string }
    | { title?: string; url?: string; message: string };

  export type ShareOptions = {
    dialogTitle?: string;
    excludedActivityTypes?: string[];
    tintColor?: string;
    subject?: string;
    anchor?: number;
  };

  export type ShareAction = {
    action: 'sharedAction' | 'dismissedAction';
    activityType?: string | null;
  };

  const Share: {
    share(content: ShareContent, options?: ShareOptions): Promise<ShareAction>;
    sharedAction: 'sharedAction';
    dismissedAction: 'dismissedAction';
  };

  export default Share;
}
