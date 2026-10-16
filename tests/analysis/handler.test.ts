import { describe, expect, it } from "vitest";
import { handleRequest } from "../../src/analysis/handler";
import { ANALYZER_VERSION } from "../../src/config/analysis";

const SR = 48000;

describe("handleRequest", () => {
  it("replies with the analysis result under the request id", () => {
    const reply = handleRequest({ id: 7, pcm: new Float32Array(SR), sampleRate: SR, callType: "quack" });
    expect(reply).toMatchObject({ id: 7, result: { callType: "quack", analyzerVersion: ANALYZER_VERSION } });
  });

  it("replies with an error for an unknown call type", () => {
    const reply = handleRequest({ id: 1, pcm: new Float32Array(SR), sampleRate: SR, callType: "honk" as never });
    expect(reply).toEqual({ id: 1, error: expect.stringContaining("call type") });
  });

  it.each([0, -48000, Number.NaN, Number.POSITIVE_INFINITY])("replies with an error for sample rate %s", (sampleRate) => {
    const reply = handleRequest({ id: 2, pcm: new Float32Array(SR), sampleRate, callType: "quack" });
    expect(reply).toEqual({ id: 2, error: expect.stringContaining("sample rate") });
  });

  it("replies with an error when the pcm is not a Float32Array", () => {
    const reply = handleRequest({ id: 3, pcm: [0, 1] as never, sampleRate: SR, callType: "quack" });
    expect(reply).toEqual({ id: 3, error: expect.stringContaining("Float32Array") });
  });

  it("turns an exception from the analyzer into an error reply", () => {
    const failing = () => {
      throw new Error("analyzer blew up");
    };
    const reply = handleRequest({ id: 4, pcm: new Float32Array(10), sampleRate: SR, callType: "quack" }, failing);
    expect(reply).toEqual({ id: 4, error: "analyzer blew up" });
  });

  it("describes a non-Error throw rather than losing it", () => {
    const failing = () => {
      throw "plain string";
    };
    const reply = handleRequest({ id: 5, pcm: new Float32Array(10), sampleRate: SR, callType: "quack" }, failing);
    expect(reply).toEqual({ id: 5, error: "plain string" });
  });
});
