import CopyButton from "@/components/copy-button";

const COMMAND = "npm i @polishd/next";

export default function InstallCommand() {
  return (
    <div className="inline-flex items-center gap-3 rounded-[10px] border border-line bg-surface py-[11px] pl-[14px] pr-3 font-mono text-[13px] text-fg transition-colors duration-200 hover:border-fg-4">
      <span>
        <span className="text-fg-4">$</span> {COMMAND}
      </span>
      <CopyButton text={COMMAND} label={`"${COMMAND}"`} />
    </div>
  );
}
