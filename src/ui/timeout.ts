const TIMEOUT_ERROR_NAME = "TimeoutError";

/** True for the error `withTimeout` rejects with when time runs out. */
export function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === TIMEOUT_ERROR_NAME;
}

/**
 * Settles like `promise`, unless `ms` pass first: then it rejects with an Error named "TimeoutError".
 * The original promise keeps running (a promise can't be cancelled); its late result is ignored.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`It took longer than ${ms / 1000} s.`);
      error.name = TIMEOUT_ERROR_NAME;
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
