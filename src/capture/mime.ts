const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"] as const;

/** First recording format the browser supports, or null when it supports none. */
export function pickMimeType(isSupported: (mimeType: string) => boolean): string | null {
  return PREFERRED_MIME_TYPES.find((mimeType) => isSupported(mimeType)) ?? null;
}
