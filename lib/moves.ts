export type Move = {
  /** Short label printed under the button. */
  label: string;
  /** Default glyph, overridden if the user uploads an icon for this lane. */
  glyph: string;
  /** Bright colour used for the beam and note. */
  beam: string;
  /** Deeper colour used for the pad and the button face. */
  pad: string;
};

/** Five body-percussion moves, low frequencies on the left. */
export const DEFAULT_MOVES: Move[] = [
  { label: 'STOMP', glyph: '👟', beam: '#FFE23D', pad: '#E0A900' },
  { label: 'PAT',   glyph: '👐', beam: '#3FE0D0', pad: '#13936F' },
  { label: 'CHEST', glyph: '✋', beam: '#9A5BFF', pad: '#6225B0' },
  { label: 'CLAP',  glyph: '👏', beam: '#FF4357', pad: '#C32340' },
  { label: 'SNAP',  glyph: '🤌', beam: '#FF5BD6', pad: '#B22F99' },
];
