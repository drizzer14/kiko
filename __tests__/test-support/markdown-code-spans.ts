// The inline-code-span reader that cited-paths.test.ts and skill-identifiers.test.ts share: both
// check what a skill or doc names in backticks against the repository, so both must read the same
// spans. A span is single or multi-backtick and may wrap across lines of one paragraph; a fenced
// block holds illustrative trees and worked examples, not claims about this tree, so it is skipped.
export const INLINE_CODE_PATTERN = /(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/g;

const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

export type Paragraph = { firstLine: number; text: string };

export const paragraphsOutsideFences = (markdown: string): Paragraph[] => {
  const paragraphs: Paragraph[] = [];
  let fence: string | undefined;
  let current: { firstLine: number; lines: string[] } | undefined;

  const closeParagraph = () => {
    if (current !== undefined) {
      paragraphs.push({ firstLine: current.firstLine, text: current.lines.join('\n') });
    }

    current = undefined;
  };

  markdown.split('\n').forEach((lineText, lineIndex) => {
    const fenceMatch = FENCE_PATTERN.exec(lineText);

    if (fence !== undefined) {
      if (fenceMatch?.[1].startsWith(fence)) {
        fence = undefined;
      }

      return;
    }

    if (fenceMatch !== null) {
      closeParagraph();
      fence = fenceMatch[1];

      return;
    }

    if (lineText.trim() === '') {
      closeParagraph();

      return;
    }

    current = current ?? { firstLine: lineIndex + 1, lines: [] };
    current.lines.push(lineText);
  });

  closeParagraph();

  return paragraphs;
};

export const lineCountBefore = (text: string, offset: number): number =>
  text.slice(0, offset).split('\n').length - 1;
