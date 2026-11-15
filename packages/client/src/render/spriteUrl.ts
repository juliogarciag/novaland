/** Where a sheet lives: `public/sprites/<key>.png`, served from the site root. */
export function spriteSheetUrl(key: string): string {
  return `${import.meta.env.BASE_URL}sprites/${key}.png`;
}
