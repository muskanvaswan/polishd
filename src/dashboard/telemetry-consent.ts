"use server";
/**
 * Polishd — telemetry consent actions.
 *
 * The consent prompt's two buttons land here. Guarded like every other action
 * in the package: server actions are independently addressable POST endpoints,
 * so without the auth check anyone who found the action id could flip a
 * dashboard's telemetry on. See ai/guard.ts.
 */
import { requirePolishdAuth } from "../ai/guard";
import { saveTelemetryConsent } from "../server/telemetry";

export async function grantPolishdTelemetry(): Promise<void> {
  await requirePolishdAuth();
  await saveTelemetryConsent(true);
}

export async function denyPolishdTelemetry(): Promise<void> {
  await requirePolishdAuth();
  await saveTelemetryConsent(false);
}
