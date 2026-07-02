"use client";

/**
 * Buffd — AI summary card (client).
 *
 * Sits at the top of the dashboard. First visit walks the owner through a
 * four-step setup (connect a model → describe the site → scan the codebase →
 * pick a refresh cadence); after that the card is just the story: summary text,
 * when it was generated, a refresh icon to force a regenerate, and a gear that
 * reveals the full settings (including the project profile) on demand.
 *
 * The card renders the cached summary handed down from the server on first
 * paint — no model call on load. A model is only hit on explicit actions or
 * the server-side cadence refresh. The API key is write-only: we never receive
 * it back, only a "configured" flag.
 */
import { useState, useTransition, type ReactNode } from "react";

import {
  generateProfileAction,
  generateSummaryAction,
  saveAISettingsAction,
} from "../ai/actions";
import type {
  BuffdAIProvider,
  BuffdAISettingsPublic,
  BuffdProjectProfile,
  BuffdRefreshCadence,
  BuffdSummary,
} from "../ai/types";

const border = "border-[#2e2e2e]";
const card = `border ${border} rounded-lg bg-[#0a0a0a]`;
const labelCls = "text-[11px] font-medium uppercase tracking-[0.08em] text-[#666]";
const inputCls =
  "w-full rounded-md border border-[#2e2e2e] bg-[#111] px-3 py-2 text-[13px] text-white placeholder:text-[#555] focus:border-[#555] focus:outline-none";
const primaryBtn =
  "rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtn =
  "rounded-md border border-[#2e2e2e] px-2.5 py-1.5 text-[12px] text-[#aaa] transition-colors hover:border-[#555] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const iconBtn =
  "flex h-7 w-7 items-center justify-center rounded-md border border-[#2e2e2e] text-[#aaa] transition-colors hover:border-[#555] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

const PROVIDERS: {
  value: BuffdAIProvider;
  label: string;
  modelHint: string;
  keyUrl: string;
  keyHost: string;
}[] = [
  {
    value: "anthropic",
    label: "Anthropic (Claude)",
    modelHint: "claude-opus-4-8",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHost: "console.anthropic.com",
  },
  {
    value: "openai",
    label: "OpenAI",
    modelHint: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHost: "platform.openai.com",
  },
  {
    value: "openai-compatible",
    label: "OpenAI-compatible",
    modelHint: "model id",
    keyUrl: "https://openrouter.ai/keys",
    keyHost: "your provider (e.g. openrouter.ai)",
  },
  {
    value: "google",
    label: "Google (Gemini)",
    modelHint: "gemini-1.5-flash",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyHost: "aistudio.google.com",
  },
];

const CADENCES: { value: BuffdRefreshCadence; label: string; hint: string }[] = [
  { value: "manual", label: "Manual", hint: "Only when you press refresh" },
  { value: "daily", label: "Daily", hint: "Refreshes on your first dashboard visit each day, if data changed" },
  { value: "weekly", label: "Weekly", hint: "Refreshes at most once a week, if data changed" },
];

function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── Icons (Feather, inlined) ─────────────────────────────────────────────────
function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : undefined}
      aria-hidden
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export interface SummaryCardProps {
  initialSummary: BuffdSummary | null;
  initialSettings: BuffdAISettingsPublic;
  initialStale: boolean;
  initialProfile: BuffdProjectProfile | null;
  /** Component identifiers in the analytics that the profile doesn't cover. */
  initialGaps: string[];
  /** Whether the app's source tree is on disk here (scan possible). */
  sourceAvailable: boolean;
}

export default function SummaryCard({
  initialSummary,
  initialSettings,
  initialStale,
  initialProfile,
  initialGaps,
  sourceAvailable,
}: SummaryCardProps) {
  const [summary, setSummary] = useState<BuffdSummary | null>(initialSummary);
  const [settings, setSettings] = useState<BuffdAISettingsPublic>(initialSettings);
  const [stale, setStale] = useState(initialStale);
  const [profile, setProfile] = useState<BuffdProjectProfile | null>(initialProfile);
  const [gaps, setGaps] = useState<string[]>(initialGaps);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // The wizard shows exactly once: a fresh install (no key, nothing cached).
  // After step 1 saves a key, reloads land on the normal card for good.
  const [onboarding, setOnboarding] = useState(
    !initialSettings.hasApiKey && !initialSummary && !initialSettings.fromEnv,
  );
  const [pending, startGenerate] = useTransition();

  const generate = (force: boolean) => {
    setError(null);
    startGenerate(async () => {
      const res = await generateSummaryAction(force);
      if (res.ok) {
        setSummary(res.summary);
        setStale(false);
      } else {
        if (res.error === "no-key") setShowSettings(true);
        setError(res.message);
      }
    });
  };

  const hasSummary = summary !== null;
  const cadence = settings.refreshCadence ?? "manual";

  return (
    <section className={`mb-8 ${card} overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 border-b ${border} px-4 py-3 sm:px-5`}>
        <div className="flex items-center gap-2">
          <span className={labelCls}>AI summary</span>
          {settings.hasApiKey && (
            <span className="hidden rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-medium text-[#888] sm:inline">
              {settings.provider} · {settings.model}
            </span>
          )}
        </div>
        {!onboarding && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => generate(hasSummary)}
              disabled={pending || !settings.hasApiKey}
              title={settings.hasApiKey ? "Regenerate the summary now" : "Connect a model first"}
              aria-label="Refresh summary"
              className={iconBtn}
            >
              <RefreshIcon spinning={pending} />
            </button>
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              title="Setup & settings"
              aria-label="Setup and settings"
              className={`${iconBtn} ${showSettings ? "border-[#555] text-white" : ""}`}
            >
              <GearIcon />
            </button>
          </div>
        )}
      </div>

      {onboarding ? (
        <OnboardingWizard
          settings={settings}
          sourceAvailable={sourceAvailable}
          onSettings={setSettings}
          onProfile={(p) => {
            setProfile(p);
            setGaps([]);
          }}
          onSummary={(s) => {
            setSummary(s);
            setStale(false);
          }}
          onError={setError}
          onDone={() => setOnboarding(false)}
        />
      ) : (
        <>
          {/* Body */}
          <div className="px-4 py-4 sm:px-5 sm:py-5">
            {error && (
              <div className="mb-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-[12px] text-red-400">
                {error}
              </div>
            )}

            {hasSummary ? (
              <>
                <p className="text-[14px] leading-relaxed text-[#e4e4e4]">{summary!.text}</p>
                <WinsLosses wins={summary!.wins} losses={summary!.losses} />
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#555]">
                  <span>
                    Generated {relTime(summary!.generatedAt)} · {summary!.provider}/{summary!.model}
                    {cadence !== "manual" && ` · refreshes ${cadence}`}
                  </span>
                  {stale && (
                    <span className="rounded-full bg-amber-950/50 px-2 py-0.5 text-amber-400">
                      New data since this summary — refresh to update
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] leading-relaxed text-[#888]">
                  {settings.hasApiKey
                    ? "No summary yet — generate the story of how visitors are using this site from the signals below."
                    : "No model connected. Open settings to add an API key."}
                </p>
                <button
                  type="button"
                  onClick={() => (settings.hasApiKey ? generate(false) : setShowSettings(true))}
                  disabled={pending}
                  className={primaryBtn}
                >
                  {pending ? "Thinking…" : settings.hasApiKey ? "Generate summary" : "Open settings"}
                </button>
              </div>
            )}
          </div>

          {/* Setup details — only behind the gear */}
          {showSettings && (
            <>
              <ProfileStrip
                profile={profile}
                gaps={gaps}
                hasApiKey={settings.hasApiKey}
                sourceAvailable={sourceAvailable}
                onScanned={(p) => {
                  setProfile(p);
                  setGaps([]);
                  setError(null);
                  // A new profile changes the summary's inputs — flag the cached one.
                  if (summary) setStale(true);
                }}
                onError={setError}
              />
              <SettingsPanel
                settings={settings}
                onSaved={(next) => {
                  setSettings(next);
                  setError(null);
                }}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

// ── Wins & losses ────────────────────────────────────────────────────────────
function WinsLosses({
  wins,
  losses,
}: {
  wins: BuffdSummary["wins"];
  losses: BuffdSummary["losses"];
}) {
  const hasWins = !!wins?.length;
  const hasLosses = !!losses?.length;
  if (!hasWins && !hasLosses) return null;
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {hasWins && (
        <div>
          <div className={`${labelCls} mb-2 text-emerald-500`}>Wins</div>
          <ul className="space-y-1.5">
            {wins!.map((w, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#bbb]">
                <span className="mt-px shrink-0 text-emerald-500">✓</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasLosses && (
        <div>
          <div className={`${labelCls} mb-2 text-red-400`}>Losses</div>
          <ul className="space-y-2.5">
            {losses!.map((l, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#bbb]">
                <span className="mt-px shrink-0 text-red-400">✕</span>
                <span>
                  {l.issue}
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[10px] text-[#888]">
                      {l.evidence}
                    </code>
                    {l.location ? (
                      <code className="rounded bg-[#101c14] px-1.5 py-0.5 font-mono text-[10px] text-emerald-500">
                        {l.location}
                      </code>
                    ) : (
                      <span
                        className="rounded bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-[#666]"
                        title="The citation is real analytics data, but no matching file was found on disk (dynamic content, or source not available here)."
                      >
                        not matched to source
                      </span>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Onboarding wizard ────────────────────────────────────────────────────────
const STEPS = ["Model", "Your site", "Codebase", "Cadence"] as const;

function StepShell({
  step,
  title,
  intro,
  children,
}: {
  step: number;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="px-4 py-5 sm:px-5">
      <div className="mb-4 flex items-center gap-1.5">
        {STEPS.map((name, i) => (
          <span key={name} className="flex items-center gap-1.5">
            <span
              className={`flex h-5 items-center rounded-full px-2 text-[10px] font-medium ${
                i === step
                  ? "bg-white text-black"
                  : i < step
                    ? "bg-[#1a1a1a] text-emerald-400"
                    : "bg-[#1a1a1a] text-[#555]"
              }`}
            >
              {i < step ? "✓ " : `${i + 1} · `}
              {name}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-[#2e2e2e]" />}
          </span>
        ))}
      </div>
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-[#888]">{intro}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function OnboardingWizard({
  settings,
  sourceAvailable,
  onSettings,
  onProfile,
  onSummary,
  onError,
  onDone,
}: {
  settings: BuffdAISettingsPublic;
  sourceAvailable: boolean;
  onSettings: (next: BuffdAISettingsPublic) => void;
  onProfile: (p: BuffdProjectProfile) => void;
  onSummary: (s: BuffdSummary) => void;
  /** Errors raised as the wizard closes — shown by the card, which outlives it. */
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — model
  const [provider, setProvider] = useState<BuffdAIProvider>(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? "");
  // Step 2 — site
  const [context, setContext] = useState(settings.context ?? "");
  const [audience, setAudience] = useState(settings.audience ?? "");
  const [ideology, setIdeology] = useState(settings.ideology ?? "");
  // Step 3 — codebase
  const [sourceDirs, setSourceDirs] = useState(settings.sourceDirs ?? "");
  const [scanned, setScanned] = useState<BuffdProjectProfile | null>(null);
  // Step 4 — cadence
  const [cadence, setCadence] = useState<BuffdRefreshCadence>("manual");

  const [pending, startStep] = useTransition();
  const prov = PROVIDERS.find((p) => p.value === provider);

  const next = () => {
    setError(null);
    setStep((s) => s + 1);
  };

  const saveModel = () =>
    startStep(async () => {
      const saved = await saveAISettingsAction({ provider, model, apiKey, baseUrl });
      onSettings(saved);
      setApiKey("");
      if (!saved.hasApiKey) {
        setError("Paste an API key to continue — the model can't be called without one.");
        return;
      }
      next();
    });

  const saveSite = () =>
    startStep(async () => {
      onSettings(await saveAISettingsAction({ context, audience, ideology }));
      next();
    });

  const scan = () =>
    startStep(async () => {
      setError(null);
      onSettings(await saveAISettingsAction({ sourceDirs }));
      const res = await generateProfileAction();
      if (res.ok) {
        setScanned(res.profile);
        onProfile(res.profile);
      } else {
        setError(res.message);
      }
    });

  const finish = () =>
    startStep(async () => {
      onSettings(await saveAISettingsAction({ refreshCadence: cadence }));
      const res = await generateSummaryAction(false);
      if (res.ok) onSummary(res.summary);
      else onError(res.message); // wizard is closing — surface it on the card
      onDone();
    });

  return (
    <div className="bg-[#080808]">
      {error && (
        <div className="mx-4 mt-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-[12px] text-red-400 sm:mx-5">
          {error}
        </div>
      )}

      {step === 0 && (
        <StepShell
          step={0}
          title="Connect a model"
          intro="Bring your own key — pick the provider you already pay for. The key is stored server-side in your database and never sent back to the browser."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Provider</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as BuffdAIProvider)}
                className={`${inputCls} mt-1.5`}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={prov?.modelHint}
                className={`${inputCls} mt-1.5 font-mono`}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.hasApiKey ? "•••••••• (stored — leave blank to keep)" : "Paste your key"}
                autoComplete="off"
                className={`${inputCls} mt-1.5`}
              />
              {prov && (
                <span className="mt-1 block text-[11px] text-[#555]">
                  Get a key from{" "}
                  <a
                    href={prov.keyUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[#888] underline decoration-[#444] underline-offset-2 hover:text-white"
                  >
                    {prov.keyHost}
                  </a>
                  .
                </span>
              )}
            </label>
            {provider === "openai-compatible" && (
              <label className="block sm:col-span-2">
                <span className={labelCls}>Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  className={`${inputCls} mt-1.5 font-mono`}
                />
              </label>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={saveModel}
              disabled={pending || (!apiKey && !settings.hasApiKey)}
              className={primaryBtn}
            >
              {pending ? "Saving…" : "Continue"}
            </button>
            <button type="button" onClick={onDone} className="text-[11px] text-[#555] hover:text-[#888]">
              Skip setup
            </button>
          </div>
        </StepShell>
      )}

      {step === 1 && (
        <StepShell
          step={1}
          title="Tell it about your site"
          intro="Optional, but the story gets sharper when the model knows what the site is for and who it serves. All three feed the codebase profile in the next step."
        >
          <label className="block">
            <span className={labelCls}>What is this site?</span>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
              placeholder="e.g. A personal notes site. Visitors read articles and browse by tag. The /admin editor is owner-only."
              className={`${inputCls} mt-1.5 resize-y`}
            />
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Target audience</span>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. Recruiters and fellow designers"
                className={`${inputCls} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Ideology / values</span>
              <input
                value={ideology}
                onChange={(e) => setIdeology(e.target.value)}
                placeholder="e.g. Depth over clicks — long reads matter most"
                className={`${inputCls} mt-1.5`}
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" onClick={saveSite} disabled={pending} className={primaryBtn}>
              {pending ? "Saving…" : "Continue"}
            </button>
            <button type="button" onClick={next} className={ghostBtn}>
              Skip
            </button>
          </div>
        </StepShell>
      )}

      {step === 2 && (
        <StepShell
          step={2}
          title="Scan your codebase"
          intro="A one-time scan teaches the model your pages and components, so every future summary understands the site without re-reading code. It's cached in your database — the codebase is only touched again if new components appear or you re-scan."
        >
          {scanned ? (
            <div className="rounded-md border border-emerald-900/50 bg-emerald-950/20 px-3 py-2.5 text-[12px] text-emerald-400">
              Profiled {scanned.sourceFiles} files · {scanned.coveredIdentifiers.length} components
              {scanned.truncated ? " (large app — clipped to budget)" : ""}. The model now knows your
              site's structure.
            </div>
          ) : (
            <>
              {!sourceAvailable && (
                <div className="mb-3 rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[12px] text-amber-400">
                  No source tree found on disk here — this step needs to run where the code lives
                  (local dev or CI). You can skip it now and scan later.
                </div>
              )}
              <label className="block max-w-md">
                <span className={labelCls}>Source folders</span>
                <span className="ml-1 text-[11px] text-[#555]">— optional; defaults to src / app / components / pages / lib.</span>
                <input
                  value={sourceDirs}
                  onChange={(e) => setSourceDirs(e.target.value)}
                  placeholder="e.g. src, content"
                  className={`${inputCls} mt-1.5 font-mono`}
                />
              </label>
            </>
          )}
          <div className="mt-4 flex items-center gap-3">
            {scanned ? (
              <button type="button" onClick={next} className={primaryBtn}>
                Continue
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={scan}
                  disabled={pending || !sourceAvailable}
                  className={primaryBtn}
                >
                  {pending ? "Scanning…" : "Scan codebase"}
                </button>
                <button type="button" onClick={next} className={ghostBtn}>
                  Skip for now
                </button>
              </>
            )}
          </div>
        </StepShell>
      )}

      {step === 3 && (
        <StepShell
          step={3}
          title="How often should the story refresh?"
          intro="With the profile cached, a refresh only spends tokens when there's new behavior to narrate — unchanged data is always free. Auto-refresh runs in the background when you open the dashboard past the cadence."
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {CADENCES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCadence(c.value)}
                className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                  cadence === c.value
                    ? "border-white bg-[#141414]"
                    : "border-[#2e2e2e] hover:border-[#555]"
                }`}
              >
                <span className="block text-[13px] font-medium text-white">{c.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[#666]">{c.hint}</span>
              </button>
            ))}
          </div>
          <div className="mt-4">
            <button type="button" onClick={finish} disabled={pending} className={primaryBtn}>
              {pending ? "Generating your first summary…" : "Finish & generate first summary"}
            </button>
          </div>
        </StepShell>
      )}
    </div>
  );
}

// ── Project profile strip (inside settings) ──────────────────────────────────
function ProfileStrip({
  profile,
  gaps,
  hasApiKey,
  sourceAvailable,
  onScanned,
  onError,
}: {
  profile: BuffdProjectProfile | null;
  gaps: string[];
  hasApiKey: boolean;
  sourceAvailable: boolean;
  onScanned: (p: BuffdProjectProfile) => void;
  onError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, startScan] = useTransition();

  const scan = () => {
    startScan(async () => {
      const res = await generateProfileAction();
      if (res.ok) onScanned(res.profile);
      else onError(res.message);
    });
  };

  const canScan = hasApiKey && sourceAvailable && !pending;

  return (
    <div className={`border-t ${border} bg-[#080808] px-4 py-3 sm:px-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#555]">
          <span className={labelCls}>Project profile</span>
          {profile ? (
            <>
              <span>
                scanned {relTime(profile.generatedAt)} · {profile.sourceFiles} files ·{" "}
                {profile.coveredIdentifiers.length} components
                {profile.truncated ? " · clipped to budget" : ""}
              </span>
              {gaps.length > 0 && (
                <span className="rounded-full bg-amber-950/50 px-2 py-0.5 text-amber-400">
                  {gaps.length} new {gaps.length === 1 ? "component" : "components"} not covered —
                  re-scan
                </span>
              )}
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="text-[#888] underline decoration-[#444] underline-offset-2 hover:text-white"
              >
                {expanded ? "Hide" : "View"}
              </button>
            </>
          ) : (
            <span>
              {sourceAvailable
                ? "Not scanned yet — one scan teaches the model your pages and components, so every summary understands the site without re-reading code."
                : "Source not on disk here — run the scan in local dev; the saved profile then serves everywhere."}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={!canScan}
          title={
            !hasApiKey
              ? "Add an API key first"
              : !sourceAvailable
                ? "No source tree found on disk"
                : undefined
          }
          className="rounded-md border border-[#2e2e2e] px-2.5 py-1 text-[11px] text-[#aaa] transition-colors hover:border-[#555] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Scanning…" : profile ? "Re-scan codebase" : "Scan codebase"}
        </button>
      </div>
      {expanded && profile && (
        <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-[#999]">
          {profile.text}
        </p>
      )}
    </div>
  );
}

// ── Full settings form (inside settings) ─────────────────────────────────────
function SettingsPanel({
  settings,
  onSaved,
}: {
  settings: BuffdAISettingsPublic;
  onSaved: (next: BuffdAISettingsPublic) => void;
}) {
  const [provider, setProvider] = useState<BuffdAIProvider>(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? "");
  const [instructions, setInstructions] = useState(settings.instructions ?? "");
  const [context, setContext] = useState(settings.context ?? "");
  const [audience, setAudience] = useState(settings.audience ?? "");
  const [ideology, setIdeology] = useState(settings.ideology ?? "");
  const [sourceDirs, setSourceDirs] = useState(settings.sourceDirs ?? "");
  const [cadence, setCadence] = useState<BuffdRefreshCadence>(settings.refreshCadence ?? "manual");
  const [saved, setSaved] = useState(false);
  const [pending, startSave] = useTransition();

  const prov = PROVIDERS.find((p) => p.value === provider);
  const modelHint = prov?.modelHint ?? "";

  const save = () => {
    setSaved(false);
    startSave(async () => {
      const next = await saveAISettingsAction({
        provider,
        model,
        apiKey, // blank keeps the stored key
        baseUrl,
        instructions,
        context,
        audience,
        ideology,
        sourceDirs,
        refreshCadence: cadence,
      });
      onSaved(next);
      setApiKey("");
      setSaved(true);
    });
  };

  return (
    <div className={`border-t ${border} bg-[#080808] px-4 py-4 sm:px-5 sm:py-5`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as BuffdAIProvider)}
            className={`${inputCls} mt-1.5`}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Model</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={modelHint}
            className={`${inputCls} mt-1.5 font-mono`}
          />
        </label>

        <label className="block">
          <span className={labelCls}>API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.hasApiKey ? "•••••••• (stored — leave blank to keep)" : "Paste your key"}
            autoComplete="off"
            className={`${inputCls} mt-1.5`}
          />
          {prov && (
            <span className="mt-1 block text-[11px] text-[#555]">
              Get a key from{" "}
              <a
                href={prov.keyUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[#888] underline decoration-[#444] underline-offset-2 hover:text-white"
              >
                {prov.keyHost}
              </a>
              . Stored server-side; never sent to the browser.
            </span>
          )}
        </label>

        <label className="block">
          <span className={labelCls}>Auto-refresh</span>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as BuffdRefreshCadence)}
            className={`${inputCls} mt-1.5`}
          >
            {CADENCES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label} — {c.hint.toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        {provider === "openai-compatible" && (
          <label className="block">
            <span className={labelCls}>Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              className={`${inputCls} mt-1.5 font-mono`}
            />
          </label>
        )}
      </div>

      <label className="mt-4 block">
        <span className={labelCls}>Site description</span>
        <span className="ml-1 text-[11px] text-[#555]">— what the site is, who it&apos;s for, key flows. Helps the model interpret the numbers.</span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          placeholder="e.g. A personal notes site. Visitors read articles and browse by tag. The /admin editor is owner-only."
          className={`${inputCls} mt-1.5 resize-y`}
        />
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Target audience</span>
          <span className="ml-1 text-[11px] text-[#555]">— optional; guides the profile scan.</span>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. Recruiters and fellow designers"
            className={`${inputCls} mt-1.5`}
          />
        </label>

        <label className="block">
          <span className={labelCls}>Ideology / values</span>
          <span className="ml-1 text-[11px] text-[#555]">— optional: what success looks like.</span>
          <input
            value={ideology}
            onChange={(e) => setIdeology(e.target.value)}
            placeholder="e.g. Depth over clicks — long reads matter most"
            className={`${inputCls} mt-1.5`}
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className={labelCls}>Instructions</span>
        <span className="ml-1 text-[11px] text-[#555]">— optional: tone, focus, what to call out.</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
          placeholder="e.g. Focus on conversion blockers. Keep it blunt."
          className={`${inputCls} mt-1.5 resize-y`}
        />
      </label>

      <label className="mt-4 block">
        <span className={labelCls}>Source folders</span>
        <span className="ml-1 text-[11px] text-[#555]">
          — optional, comma-separated, relative to the project root. Defaults to src / app /
          components / pages / lib.
        </span>
        <input
          value={sourceDirs}
          onChange={(e) => setSourceDirs(e.target.value)}
          placeholder="e.g. src, content"
          className={`${inputCls} mt-1.5 font-mono`}
        />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className={primaryBtn}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-[12px] text-emerald-400">Saved</span>}
        {settings.fromEnv && (
          <span className="text-[11px] text-[#555]">Defaults loaded from environment variables.</span>
        )}
      </div>
    </div>
  );
}
