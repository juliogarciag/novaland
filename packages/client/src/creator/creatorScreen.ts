import {
  CHARACTER_PARTS,
  CHARACTER_SHAPE_PARTS,
  characterPalettes,
  characterShapes,
  MAX_NAME_CHARACTERS,
  readCharacter,
  readCharacterName,
  type Character,
  type CharacterLook,
  type CharacterNameProblem,
  type CharacterPart,
  type CharacterShapePart,
  type LookPart,
  type SpriteDirection,
} from '@novaland/sim';
import { cssColor, layerSheetsOf, lookKey, paintFigure } from '../render/characterSheet';
import { facingOfKeyPress } from './facingKeys';

/** What the preview needs of the character's sheets: the size of one frame, the frame a figure stands in facing each way, and where the sheet under a sprite key is (the layer sheets a look is drawn from). */
export interface PreviewSheet {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly idleFrames: Readonly<Record<SpriteDirection, number>>;
  urlOf(sheetKey: string): string;
}

export interface CreatorScreenOptions {
  /** What the form starts with: the remembered character when changing it, a suggestion for a first visit. */
  readonly initial: { readonly name: string; readonly look: CharacterLook };
  readonly previewSheet: PreviewSheet;
}

/** Screen pixels per sheet pixel in the preview. */
const PREVIEW_SCALE = 3;

const PART_LABELS: Readonly<Record<LookPart, string>> = { skin: 'Skin', hair: 'Hair', clothes: 'Clothes', gender: 'Gender', hairStyle: 'Hairstyle' };

/**
 * The creator: the screen where a player picks a gender, a hairstyle, a
 * skin, hair and clothes colour and a name before entering the world.
 * Picking a gender also picks the hairstyle the sim suggests for it
 * (`defaultHairStyle`); the player may pick another one after. Plain DOM over the page, like
 * the connection screens, because it shows before the game exists. It decides
 * nothing: the palettes come from the sim and so does the verdict on the
 * name (`readCharacter`), which is the same rule the server applies. The
 * promise resolves with the character once the player submits a legal one,
 * and the screen is gone. `data-screen="creator"` names it for end-to-end
 * checks.
 */
export function chooseCharacter(parent: HTMLElement, options: CreatorScreenOptions): Promise<Character> {
  return new Promise((resolve) => {
    showCreator(parent, options, { title: 'Create your character', submitLabel: 'Enter the world', onSubmit: resolve });
  });
}

/**
 * The creator for a player who is already in the world: the same screen,
 * drawn over the running game, that can also be left without choosing (its
 * close button, or Escape). Resolves with what the player submitted, or
 * undefined when they left it.
 */
export function changeCharacter(parent: HTMLElement, options: CreatorScreenOptions): Promise<Character | undefined> {
  return new Promise((resolve) => {
    showCreator(parent, options, { title: 'Change your character', submitLabel: 'Save', onSubmit: resolve, onDismiss: () => resolve(undefined) });
  });
}

interface CreatorScreenUse {
  readonly title: string;
  readonly submitLabel: string;
  onSubmit(character: Character): void;
  /** Given when the screen may be left without choosing: it then has a close button, closes on Escape and lets the game show behind it. */
  onDismiss?(): void;
}

function showCreator(parent: HTMLElement, { initial, previewSheet }: CreatorScreenOptions, { title: titleText, submitLabel, onSubmit, onDismiss }: CreatorScreenUse): void {
  const look: Record<LookPart, number> = { ...initial.look };

  const form = document.createElement('form');
  form.id = 'creator';
  form.dataset['screen'] = 'creator';
  form.noValidate = true;

  const title = document.createElement('h1');
  title.textContent = titleText;

  const preview = document.createElement('canvas');
  preview.className = 'creator-preview';
  preview.width = previewSheet.frameWidth * PREVIEW_SCALE;
  preview.height = previewSheet.frameHeight * PREVIEW_SCALE;
  const characterView = characterPreview(preview, previewSheet);
  const paintPreview = characterView.show;

  const nameInput = document.createElement('input');
  nameInput.name = 'name';
  nameInput.type = 'text';
  nameInput.value = initial.name;
  nameInput.setAttribute('autocomplete', 'nickname');
  nameInput.spellcheck = false;
  nameInput.placeholder = `Up to ${MAX_NAME_CHARACTERS} characters`;
  const nameField = document.createElement('label');
  nameField.className = 'creator-name';
  const nameCaption = document.createElement('span');
  nameCaption.textContent = 'Name';
  nameField.append(nameCaption, nameInput);

  const problem = document.createElement('p');
  problem.className = 'creator-problem';
  problem.setAttribute('role', 'alert');
  const showProblem = (found: CharacterNameProblem | undefined): void => {
    problem.textContent = found ? describeNameProblem(found) : '';
    if (found) problem.dataset['problem'] = found;
    else delete problem.dataset['problem'];
    nameInput.setAttribute('aria-invalid', found ? 'true' : 'false');
  };
  // A problem shown by a submit goes away as soon as the player types; it is only ever raised by a submit.
  nameInput.addEventListener('input', () => showProblem(undefined));

  const pickHandlerFor = (part: LookPart) => (index: number) => {
    look[part] = index;
    paintPreview(look);
  };
  const shapes = CHARACTER_SHAPE_PARTS.map((part) => shapePicker(part, look[part], pickHandlerFor(part)));
  // A gender comes with the hairstyle the sim suggests for it, shown as picked so the player sees it and can pick another.
  // The fieldset hears the change after the gender's own radio has stored it in the look.
  shapes[CHARACTER_SHAPE_PARTS.indexOf('gender')]?.addEventListener('change', () => {
    const suggested = characterShapes.gender[look.gender]?.defaultHairStyle;
    const radio = form.querySelector<HTMLInputElement>(`input[name="hairStyle"][value="${String(suggested)}"]`);
    if (suggested === undefined || !radio) return;
    radio.checked = true;
    pickHandlerFor('hairStyle')(suggested);
  });
  const palettes = CHARACTER_PARTS.map((part) => swatchPicker(part, look[part], pickHandlerFor(part)));

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = submitLabel;

  form.append(title, preview, nameField, problem, ...shapes, ...palettes, submit);

  // The keys that walk in the game turn the figure, while the player is not typing.
  const onFacingKey = (event: KeyboardEvent): void => {
    const facing = facingOfKeyPress(event);
    if (!facing) return;
    // An arrow on a picker would otherwise pick the next choice, and on the page scroll it.
    event.preventDefault();
    characterView.face(facing);
  };
  document.addEventListener('keydown', onFacingKey);
  let stopListeningForEscape = (): void => {};
  const close = (): void => {
    document.removeEventListener('keydown', onFacingKey);
    stopListeningForEscape();
    form.remove();
  };
  if (onDismiss) {
    const dismiss = (): void => {
      close();
      onDismiss();
    };
    form.classList.add('creator-over-game');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'creator-close';
    closeButton.textContent = '\u00d7';
    closeButton.title = 'Close (Esc)';
    closeButton.setAttribute('aria-label', 'Close without changing');
    closeButton.addEventListener('click', dismiss);
    form.prepend(closeButton);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    stopListeningForEscape = () => document.removeEventListener('keydown', onKeyDown);
  }

  parent.append(form);
  paintPreview(look);
  nameInput.focus({ preventScroll: true });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = readCharacterName(nameInput.value);
    if ('problem' in name) {
      showProblem(name.problem);
      nameInput.focus({ preventScroll: true });
      return;
    }
    const character = readCharacter({ name: name.name, look: { ...look } });
    if (!character) return;
    close();
    onSubmit(character);
  });
}

/** What the player reads under the name field when the sim's rule refuses the name. */
function describeNameProblem(problem: CharacterNameProblem): string {
  switch (problem) {
    case 'not-text':
    case 'empty':
      return 'Your character needs a name.';
    case 'too-long':
      return `That name is too long: use ${MAX_NAME_CHARACTERS} characters or fewer. Emoji made of several parts count for more.`;
    case 'forbidden-character':
      return 'That name has characters that cannot be shown, or marks piled on one letter. Use letters, numbers, spaces and emoji.';
  }
}

/** One row of colour swatches for a part: radio buttons, so the keyboard and screen readers work as for any choice. */
function swatchPicker(part: CharacterPart, selected: number, onPick: (index: number) => void): HTMLFieldSetElement {
  const fieldset = document.createElement('fieldset');
  fieldset.dataset['part'] = part;
  const legend = document.createElement('legend');
  legend.textContent = PART_LABELS[part];
  fieldset.append(legend);
  characterPalettes[part].forEach((swatch, index) => {
    const option = document.createElement('label');
    option.className = 'creator-swatch';
    option.title = swatch.name;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = part;
    radio.value = String(index);
    radio.checked = index === selected;
    radio.setAttribute('aria-label', `${PART_LABELS[part]}: ${swatch.name}`);
    radio.addEventListener('change', () => {
      if (radio.checked) onPick(index);
    });
    const chip = document.createElement('span');
    chip.style.background = cssColor(swatch.color);
    option.append(radio, chip);
    fieldset.append(option);
  });
  return fieldset;
}

/** One row of named choices for a part's shape (a gender, a hairstyle): radio buttons, like the swatches. */
function shapePicker(part: CharacterShapePart, selected: number, onPick: (index: number) => void): HTMLFieldSetElement {
  const fieldset = document.createElement('fieldset');
  fieldset.dataset['part'] = part;
  fieldset.className = 'creator-shapes';
  const legend = document.createElement('legend');
  legend.textContent = PART_LABELS[part];
  fieldset.append(legend);
  characterShapes[part].forEach((shape, index) => {
    const option = document.createElement('label');
    option.className = 'creator-shape';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = part;
    radio.value = String(index);
    radio.checked = index === selected;
    radio.setAttribute('aria-label', `${PART_LABELS[part]}: ${shape.name}`);
    radio.addEventListener('change', () => {
      if (radio.checked) onPick(index);
    });
    const caption = document.createElement('span');
    caption.textContent = shape.name;
    option.append(radio, caption);
    fieldset.append(option);
  });
  return fieldset;
}

/** The creator's preview: shows a look, and turns the figure to face a way. */
interface CharacterView {
  show(look: CharacterLook): void;
  face(facing: SpriteDirection): void;
}

/**
 * Draws the character standing in a look, facing the player until it is
 * turned: the idle frame of its gender's sheet for the way it faces, with its
 * hairstyle's over it, outlined and recoloured the way the game draws it
 * (`paintFigure`). Until both sheets have loaded (or if they never do) the
 * preview keeps what it showed and the creator works without it.
 */
function characterPreview(preview: HTMLCanvasElement, sheet: PreviewSheet): CharacterView {
  const context = preview.getContext('2d');
  const frame = document.createElement('canvas');
  frame.width = sheet.frameWidth;
  frame.height = sheet.frameHeight;
  const frameContext = frame.getContext('2d', { willReadFrequently: true });
  const images = new Map<string, HTMLImageElement>();
  const imageOf = (sheetKey: string): HTMLImageElement => {
    let image = images.get(sheetKey);
    if (!image) {
      image = new Image();
      image.addEventListener('load', () => paint());
      // A sheet that cannot load must not leave the figure of an earlier pick on show.
      image.addEventListener('error', () => {
        if (shown && Object.values(layerSheetsOf(shown) ?? {}).includes(sheetKey)) clearPreview();
      });
      image.src = sheet.urlOf(sheetKey);
      images.set(sheetKey, image);
    }
    return image;
  };
  const loaded = (image: HTMLImageElement): boolean => image.complete && image.naturalWidth > 0;
  let shown: CharacterLook | undefined;
  let facing: SpriteDirection = 'down';
  const clearPreview = (): void => {
    context?.clearRect(0, 0, preview.width, preview.height);
    delete preview.dataset['look'];
  };
  const paint = (): void => {
    const layers = shown && layerSheetsOf(shown);
    if (!context || !frameContext || !shown || !layers) return;
    const body = imageOf(layers.body);
    const hair = imageOf(layers.hair);
    if (!loaded(body) || !loaded(hair)) return;
    const standingFrame = sheet.idleFrames[facing];
    const standingFrameOf = (image: HTMLImageElement): Uint8ClampedArray => {
      const columns = Math.max(1, Math.floor(image.naturalWidth / frame.width));
      const left = (standingFrame % columns) * frame.width;
      const top = Math.floor(standingFrame / columns) * frame.height;
      frameContext.clearRect(0, 0, frame.width, frame.height);
      frameContext.drawImage(image, left, top, frame.width, frame.height, 0, 0, frame.width, frame.height);
      return frameContext.getImageData(0, 0, frame.width, frame.height).data;
    };
    const figure = paintFigure({ body: standingFrameOf(body), hair: standingFrameOf(hair), width: frame.width, height: frame.height }, shown);
    const pixels = frameContext.createImageData(frame.width, frame.height);
    pixels.data.set(figure);
    frameContext.putImageData(pixels, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(frame, 0, 0, preview.width, preview.height);
    preview.dataset['look'] = lookKey(shown);
    preview.dataset['facing'] = facing;
  };
  // Every choice is a click away: fetch all the layer sheets now, so a pick draws at once.
  for (const shape of [...characterShapes.gender, ...characterShapes.hairStyle]) imageOf(shape.sheet);
  return {
    show(look) {
      shown = { ...look };
      paint();
    },
    face(way) {
      facing = way;
      paint();
    },
  };
}

export const __testing__ = { describeNameProblem };
