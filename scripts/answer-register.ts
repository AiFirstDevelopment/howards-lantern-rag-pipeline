/**
 * The register verdict lives beside the worker (worker/src/answer-register.ts)
 * since the box itself asks a too-long answer once more, shorter, by the same
 * count the eval scores it by: two copies of a sentence counter would drift,
 * and the eval would pass answers the box had judged too long, or fail ones
 * it had judged short enough.
 */
export * from '../worker/src/answer-register'
