// The MIT license requires its notice to go with every copy of the bundled names, so the full
// text ships in the app; no screen shows it.
export const MCC_NAMES_NOTICE: Readonly<
  Record<'greggles' | 'sominemo', { source: string; licenseName: string; licenseText?: string }>
> = {
  greggles: {
    source: 'https://github.com/greggles/mcc-codes',
    licenseName: 'The Unlicense',
  },
  sominemo: {
    source: 'https://github.com/Sominemo/MCC-Localize-Dataset',
    licenseName: 'MIT License',
    licenseText: `MIT License

Copyright (c) 2020 Sominemo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
};
