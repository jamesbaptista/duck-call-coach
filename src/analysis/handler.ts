import { analyze } from "./analyze";
import type { AnalysisResult, CallType } from "./types";

/** Message the client posts to the analysis worker. The `pcm` buffer is transferred, not copied. */
export interface AnalysisRequest {
  id: number;
  pcm: Float32Array;
  sampleRate: number;
  callType: CallType;
}

/** Message the worker posts back: the result, or the reason the request failed. */
export type AnalysisReply = { id: number; result: AnalysisResult } | { id: number; error: string };

type Analyzer = (pcm: Float32Array, sampleRate: number, callType: CallType) => AnalysisResult;

const CALL_TYPES: readonly CallType[] = ["quack", "hail", "comeback", "chuckle"];

/** The reason a request cannot be analyzed, or null when it is well formed. */
function invalidReason(request: AnalysisRequest): string | null {
  if (!CALL_TYPES.includes(request.callType)) return `Unknown call type: ${String(request.callType)}`;
  if (!Number.isFinite(request.sampleRate) || request.sampleRate <= 0) {
    return `Invalid sample rate: ${String(request.sampleRate)}`;
  }
  if (!(request.pcm instanceof Float32Array)) return "The recording must be a Float32Array";
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates and analyzes one request. Always returns a reply: a bad request or an exception from the
 * analyzer becomes an error reply, so the worker never dies silently and the caller's promise settles.
 */
export function handleRequest(request: AnalysisRequest, analyzer: Analyzer = analyze): AnalysisReply {
  const invalid = invalidReason(request);
  if (invalid) return { id: request.id, error: invalid };
  try {
    return { id: request.id, result: analyzer(request.pcm, request.sampleRate, request.callType) };
  } catch (error) {
    return { id: request.id, error: messageOf(error) };
  }
}
