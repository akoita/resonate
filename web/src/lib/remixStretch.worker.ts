/**
 * Remix Studio stretch worker (#1898): runs one stretch job at a time for
 * the preview (see `remixStretchProtocol.ts`). The WASM is fetched, verified
 * and compiled on the first job, then reused; every job gets a fresh engine.
 */

import {
  createStretchModuleLoader,
  runStretchJob,
  type StretchWorkerRequest,
  type StretchWorkerResponse,
} from "./remixStretchProtocol";

// The app compiles against the DOM lib; type just the worker surface used.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<StretchWorkerRequest>) => void) | null;
  postMessage(message: StretchWorkerResponse, transfer?: Transferable[]): void;
};

const loadModule = createStretchModuleLoader();

scope.onmessage = (event) => {
  if (event.data?.type !== "stretch") return;
  void runStretchJob(event.data, loadModule, (message, transfer) =>
    scope.postMessage(message, transfer ?? []),
  );
};
