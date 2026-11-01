import { PolishdMonitor } from "@polishd/next/client";

import CopyButton from "@/components/copy-button";
import { AGENT_PROMPT } from "@/lib/agent-prompt";

/**
 * The install handed to a coding agent, as the other way to run the three
 * commands: a button that copies the prompt. The prompt itself isn't shown.
 */
export default function AgentPrompt() {
  return (
    <div
      className="card r mt-3 flex flex-col items-start gap-4 rounded-[11px] p-5 sm:flex-row sm:items-center sm:gap-6"
      style={{ "--d": "270ms" } as React.CSSProperties}
    >
      <span className="font-heading text-[34px] font-semibold leading-none tracking-[0.005em] text-fg-4">
        or
      </span>
      <div className="flex-1">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Hand it to your agent</h3>
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-[1.35] text-fg-3">
          Copy a prompt for Claude Code, Cursor or Copilot. It sends the agent to the install
          procedure, and to npm rather than a search that won&apos;t find a package this new.
        </p>
      </div>
      <PolishdMonitor name="agent-prompt-copy" className="flex shrink-0">
        <CopyButton text={AGENT_PROMPT} label="the agent prompt" idle="Copy prompt" primary />
      </PolishdMonitor>
    </div>
  );
}
