/**
 * @buffd/next/client — browser capture surface.
 *
 * `initBuffd` is framework-free vanilla DOM (call it from
 * `instrumentation-client.ts`). `BuffdMonitor` is a React component for
 * explicit, component-level tracking.
 */
export { initBuffd } from "./client/init";
export { BuffdMonitor } from "./client/monitor";
export type { BuffdConfig } from "./config";
