/**
 * @polishd/next/client — browser capture surface.
 *
 * `initPolishd` is framework-free vanilla DOM (call it from
 * `instrumentation-client.ts`). `PolishdMonitor` is a React component for
 * explicit, component-level tracking.
 */
export { initPolishd } from "./client/init";
export { PolishdMonitor } from "./client/monitor";
export type { PolishdConfig } from "./config";
