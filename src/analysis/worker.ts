import { handleRequest, type AnalysisReply, type AnalysisRequest } from "./handler";

// Runs inside a dedicated worker. Typed minimally: the DOM and WebWorker libs both declare `self`.
declare const self: {
  onmessage: ((event: { data: AnalysisRequest }) => void) | null;
  postMessage(message: AnalysisReply): void;
};

self.onmessage = (event) => {
  self.postMessage(handleRequest(event.data));
};
