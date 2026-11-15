import CopyButton from "@/components/copy-button";
import { AGENT_PROMPT } from "@/lib/agent-prompt";

/**
 * The install, handed to a coding agent: the box asks the reader to have
 * their agent set Polishd up, and Copy puts the full install prompt on the
 * clipboard to paste into Claude Code, Cursor or Copilot.
 */
export default function AgentSetup() {
  return (
    <div className="inline-flex items-center gap-3 rounded-[10px] border border-line bg-surface py-[11px] pl-[14px] pr-3 font-mono text-[13px] text-fg transition-colors duration-200 hover:border-fg-4">
      <span>
        <span className="text-fg-4">&gt;</span> Ask your agent to set it up
      </span>
      <CopyButton text={AGENT_PROMPT} label="the setup prompt for your coding agent" />
    </div>
  );
}
