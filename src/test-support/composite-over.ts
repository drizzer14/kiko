// An `rgba(r,g,b,a)` token composited over an opaque `#RRGGBB` backdrop, as the
// opaque hex a contrast check needs.
export const compositeOver = (rgba: string, backdropHex: string): string => {
  const [red, green, blue, alpha] = (rgba.match(/[\d.]+/g) ?? []).map(Number);
  const backdrop = [1, 3, 5].map((offset) => parseInt(backdropHex.slice(offset, offset + 2), 16));

  return `#${[red, green, blue]
    .map((channel, index) => Math.round(channel * alpha + backdrop[index] * (1 - alpha)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
};
