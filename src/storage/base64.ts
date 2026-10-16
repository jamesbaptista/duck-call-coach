/** Strict base64 (RFC 4648, standard alphabet, with padding) for backup files. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VALID_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** A multiple of 3, so every chunk but the last encodes to whole quads with no padding. */
const ENCODE_CHUNK_BYTES = 3 * 8192;
/** A multiple of 4, so every chunk but the last decodes to whole bytes. */
const DECODE_CHUNK_CHARS = 4 * 8192;

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += ENCODE_CHUNK_BYTES) {
    const chunk = bytes.subarray(start, start + ENCODE_CHUNK_BYTES);
    // Chunked: spreading a whole recording into one call would overflow the call stack.
    parts.push(btoa(String.fromCharCode.apply(null, chunk as unknown as number[])));
  }
  return parts.join("");
}

function paddingLength(text: string): number {
  if (text.endsWith("==")) return 2;
  return text.endsWith("=") ? 1 : 0;
}

/** How many bytes `text` decodes to, from its length alone. Null when the length cannot be valid base64. */
export function decodedByteLength(text: string): number | null {
  if (text.length % 4 !== 0) return null;
  return (text.length / 4) * 3 - paddingLength(text);
}

/**
 * Decodes `text`, or returns null if it is not canonical base64: a character outside the alphabet,
 * whitespace, bad or misplaced padding, a length that is not a multiple of 4, or non-zero bits after the data.
 */
export function decodeBase64(text: string): Uint8Array | null {
  const length = decodedByteLength(text);
  if (length === null || !VALID_BASE64.test(text)) return null;
  const padding = paddingLength(text);
  if (padding > 0) {
    const lastValue = ALPHABET.indexOf(text[text.length - padding - 1]);
    const strayBitsMask = padding === 1 ? 0b11 : 0b1111;
    if ((lastValue & strayBitsMask) !== 0) return null;
  }
  const bytes = new Uint8Array(length);
  let written = 0;
  for (let start = 0; start < text.length; start += DECODE_CHUNK_CHARS) {
    const binary = atob(text.slice(start, start + DECODE_CHUNK_CHARS));
    for (let i = 0; i < binary.length; i++) bytes[written++] = binary.charCodeAt(i);
  }
  return bytes;
}
