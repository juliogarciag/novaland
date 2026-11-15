/**
 * The mouse cursor over the game: which pixel-art cursors there are, the CSS
 * that shows one, and the key that switches between them while the designs
 * are being tried (ticket #49). The images are painted by
 * tools/generate-cursors.mjs, which lists the same names and hotspots; a test
 * holds the two lists together. Nothing here is game state.
 */

/** The cursors the player can switch between, in the order the key goes through them. `hotspot` is the point that clicks, in CSS pixels from the image's top-left corner. */
export const CURSORS = [
  { name: 'warm-arrow', hotspot: { x: 0, y: 0 } },
  { name: 'dark-dart', hotspot: { x: 0, y: 0 } },
  { name: 'brown-dart', hotspot: { x: 0, y: 0 } },
  { name: 'shaded-arrow', hotspot: { x: 0, y: 0 } },
] as const;

export type CursorName = (typeof CURSORS)[number]['name'];

/** The cursor a page shows before the player picks one. index.html names it too, so it shows before any script runs. */
export const DEFAULT_CURSOR_NAME: CursorName = CURSORS[0].name;

/** The key that switches to the next cursor, as `KeyboardEvent.code`. */
export const NEXT_CURSOR_KEY = 'KeyC';

/**
 * The values of the `cursor` property that show a cursor, in the order to
 * set them. The first is for browsers without `image-set()`; the second gives
 * 2x screens their own image and is ignored where it is not understood.
 * `auto` is what shows if the image cannot load.
 */
export function cursorDeclarations(name: CursorName): readonly [string, string] {
  const { hotspot } = CURSORS.find((cursor) => cursor.name === name) ?? CURSORS[0];
  const click = `${hotspot.x} ${hotspot.y}`;
  return [`url('/cursors/${name}.png') ${click}, auto`, `image-set(url('/cursors/${name}.png') 1x, url('/cursors/${name}@2x.png') 2x) ${click}, auto`];
}

/** The cursor the key switches to from `name`: the next of the list, and the first after the last. */
export function cursorAfter(name: CursorName): CursorName {
  const index = CURSORS.findIndex((cursor) => cursor.name === name);
  return CURSORS[(index + 1) % CURSORS.length]?.name ?? DEFAULT_CURSOR_NAME;
}

/** `value` as a cursor name, or undefined when it is not one: what was remembered may be anything. */
export function cursorNamed(value: unknown): CursorName | undefined {
  return CURSORS.find((cursor) => cursor.name === value)?.name;
}

/**
 * Shows the cursor this browser remembers, if any, and from then on switches
 * to the next one each time the player presses the key. Returns a function
 * that stops listening.
 */
export function letPlayerSwitchCursors(page: Document): () => void {
  let shown = rememberedCursorName() ?? DEFAULT_CURSOR_NAME;
  if (shown !== DEFAULT_CURSOR_NAME) showCursor(page, shown);
  const switchOnKey = (event: KeyboardEvent): void => {
    // Not while typing, not for a shortcut such as copy, and once per press.
    if (event.code !== NEXT_CURSOR_KEY || event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
    shown = cursorAfter(shown);
    showCursor(page, shown);
    rememberCursorName(shown);
  };
  page.addEventListener('keydown', switchOnKey);
  return () => page.removeEventListener('keydown', switchOnKey);
}

// ---- Helpers ----

/** Where the picked cursor is kept between visits. A convenience of this browser only. */
const REMEMBERED_CURSOR_KEY = 'novaland.cursor';

function showCursor(page: Document, name: CursorName): void {
  const style = page.documentElement.style;
  // A value the browser does not understand leaves the one before it in place.
  for (const declaration of cursorDeclarations(name)) style.cursor = declaration;
  page.documentElement.dataset['cursor'] = name;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}

/** Storage can be blocked or throw (private windows): the cursor then starts at the default every visit. */
function rememberedCursorName(): CursorName | undefined {
  try {
    return cursorNamed(window.localStorage.getItem(REMEMBERED_CURSOR_KEY));
  } catch {
    return undefined;
  }
}

function rememberCursorName(name: CursorName): void {
  try {
    window.localStorage.setItem(REMEMBERED_CURSOR_KEY, name);
  } catch {
    // Not remembered; the cursor still switched.
  }
}
