export type CallType = "quack" | "hail" | "comeback" | "chuckle";

/** A run of analysis frames holding one note. `endFrame` is exclusive. */
export interface NoteSpan {
  startFrame: number;
  endFrame: number;
}
