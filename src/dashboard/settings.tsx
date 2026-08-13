"use client";

/**
 * Polishd — the Settings tab.
 *
 * Everything about *configuring* Polishd: which model to call, what the site
 * is, the cached codebase profile, and the GitHub connection. All of it used
 * to live behind a gear on the analytics summary card, which meant the first
 * screen of the dashboard was also its setup screen — the form pushed the
 * actual analytics down the page, and the design review had to send people to
 * "the Analytics tab's summary card" to connect a model it also uses. Setup is
 * its own concern, so it gets its own tab.
 *
 * The API key and GitHub token are write-only: they are sent up, stored
 * server-side, and never come back — the form only ever learns whether one
 * exists.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import {
  generateProfileAction,
  generateSummaryAction,
  listModelsAction,
  saveAISettingsAction,
  verifyGithubAction,
} from "../ai/actions";
import type {
  PolishdAIProvider,
  PolishdAISettingsPublic,
  PolishdGithubStatus,
  PolishdProjectProfile,
  PolishdRefreshCadence,
} from "../ai/types";
import {
  border,
  card,
  ghostBtn,
  inputCls,
  labelCls,
  primaryBtn,
  relTime,
} from "./ui";

export const PROVIDERS: {
  value: PolishdAIProvider;
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

const CADENCES: { value: PolishdRefreshCadence; label: string; hint: string }[] = [
  { value: "manual", label: "Manual", hint: "Only when you press refresh" },
  {
    value: "daily",
    label: "Daily",
    hint: "Refreshes on your first dashboard visit each day, if data changed",
  },
  { value: "weekly", label: "Weekly", hint: "Refreshes at most once a week, if data changed" },
];

// ── Model field ──────────────────────────────────────────────────────────────
/**
 * The "Model" input, shared by the onboarding wizard and the settings form.
 * Starts as free text (any provider works this way). If the provider exposes
 * a list-models endpoint and a usable key is available (typed in this form,
 * or already stored for this same provider), a "Load available models" link
 * fetches the live list and swaps the input for a dropdown — so the owner
 * picks from what their key can actually call instead of guessing an id.
 */
function ModelField({
  provider,
  model,
  onModel,
  apiKey,
  baseUrl,
  hasStoredKey,
}: {
  provider: PolishdAIProvider;
  model: string;
  onModel: (m: string) => void;
  /** Key typed into this form (may be blank — falls back to the stored one). */
  apiKey: string;
  baseUrl: string;
  /** True when a saved key exists for this exact provider. */
  hasStoredKey: boolean;
}) {
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startLoad] = useTransition();
  const prov = PROVIDERS.find((p) => p.value === provider);

  // A fetched list is provider-specific — drop it the moment the provider
  // changes so a stale Gemini list can't linger under "OpenAI".
  useEffect(() => {
    setModels(null);
    setError(null);
  }, [provider]);

  const needsBaseUrl = provider === "openai-compatible" && !baseUrl.trim();
  const canFetch = (apiKey.trim().length > 0 || hasStoredKey) && !needsBaseUrl;

  const load = () => {
    if (!canFetch || pending) return;
    setError(null);
    startLoad(async () => {
      const res = await listModelsAction({
        provider,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      if (res.ok) {
        setModels(res.models);
        if (res.models.length > 0 && !res.models.includes(model)) onModel(res.models[0]);
      } else {
        setError(res.message);
      }
    });
  };

  // Auto-load once when a stored key already covers this provider — most
  // visits land here with nothing to type, so the dropdown should just work.
  useEffect(() => {
    if (hasStoredKey && models === null && !pending) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStoredKey]);

  return (
    <label className="block">
      <span className={labelCls}>Model</span>
      {models && models.length > 0 ? (
        <>
          <select
            value={model}
            onChange={(e) => onModel(e.target.value)}
            className={`${inputCls} mt-1.5 font-mono`}
          >
            {!models.includes(model) && model && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setModels(null)}
            className="mt-1 text-[11px] text-[#555] hover:text-[#888]"
          >
            Type a different model id
          </button>
        </>
      ) : (
        <>
          <input
            value={model}
            onChange={(e) => onModel(e.target.value)}
            placeholder={prov?.modelHint}
            className={`${inputCls} mt-1.5 font-mono`}
          />
          <button
            type="button"
            onClick={load}
            disabled={!canFetch || pending}
            title={
              needsBaseUrl
                ? "Add a base URL first"
                : canFetch
                  ? "Fetch the list of models available to this key"
                  : "Add an API key first"
            }
            className="mt-1 text-[11px] text-[#888] underline decoration-[#444] underline-offset-2 hover:text-white disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
          >
            {pending ? "Loading models…" : "Load available models"}
          </button>
          {error && <span className="mt-1 block text-[11px] text-red-400">{error}</span>}
        </>
      )}
    </label>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

export interface SettingsViewProps {
  initialSettings: PolishdAISettingsPublic;
  initialProfile: PolishdProjectProfile | null;
  /** Component identifiers in the analytics that the profile doesn't cover. */
  initialGaps: string[];
  /** Whether the app's source tree is on disk here (scan possible). */
  sourceAvailable: boolean;
}

export default function SettingsView({
  initialSettings,
  initialProfile,
  initialGaps,
  sourceAvailable,
}: SettingsViewProps) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [profile, setProfile] = useState(initialProfile);
  const [gaps, setGaps] = useState(initialGaps);
  const [error, setError] = useState<string | null>(null);
  // The wizard is for a genuinely fresh install — no key stored and none
  // supplied by the environment. Once step 1 saves a key it never returns.
  const [onboarding, setOnboarding] = useState(
    !initialSettings.hasApiKey && !initialSettings.fromEnv,
  );

  return (
    <main className="text-white">
      <div className={`mb-8 flex items-start justify-between gap-3 border-b ${border} pb-6`}>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Settings</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#666]">
            The model Polishd calls, what it knows about your site, and where it files what it
            finds. One model serves both the analytics summary and the design review.
          </p>
        </div>
        <div
          className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium ${
            settings.hasApiKey ? "bg-emerald-950 text-emerald-400" : "bg-[#1a1a1a] text-[#666]"
          }`}
        >
          {settings.hasApiKey ? `● ${settings.provider}` : "○ no model"}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-[13px] text-red-400">
          {error}
        </div>
      )}

      {onboarding ? (
        <section className={`${card} overflow-hidden`}>
          <div className={`border-b ${border} px-4 py-3 sm:px-5`}>
            <span className={labelCls}>First-time setup</span>
          </div>
          <OnboardingWizard
            settings={settings}
            sourceAvailable={sourceAvailable}
            onSettings={setSettings}
            onProfile={(p) => {
              setProfile(p);
              setGaps([]);
            }}
            onError={setError}
            onSkip={() => setOnboarding(false)}
            onFinished={() => {
              setOnboarding(false);
              // The first summary was just generated — go and read it.
              router.push("?tab=analytics");
            }}
          />
        </section>
      ) : (
        <SettingsForm
          settings={settings}
          profile={profile}
          gaps={gaps}
          sourceAvailable={sourceAvailable}
          onSaved={(next) => {
            setSettings(next);
            setError(null);
          }}
          onProfile={(p) => {
            setProfile(p);
            setGaps([]);
            setError(null);
          }}
          onError={setError}
        />
      )}
    </main>
  );
}

// ── Onboarding wizard ────────────────────────────────────────────────────────
const STEPS = ["Model", "Your site", "Codebase", "GitHub", "Cadence"] as const;

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
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
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
  onError,
  onSkip,
  onFinished,
}: {
  settings: PolishdAISettingsPublic;
  sourceAvailable: boolean;
  onSettings: (next: PolishdAISettingsPublic) => void;
  onProfile: (p: PolishdProjectProfile) => void;
  /** Errors raised as the wizard closes — shown by the tab, which outlives it. */
  onError: (msg: string) => void;
  onSkip: () => void;
  onFinished: () => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — model
  const [provider, setProvider] = useState<PolishdAIProvider>(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? "");
  // Step 2 — site
  const [context, setContext] = useState(settings.context ?? "");
  const [audience, setAudience] = useState(settings.audience ?? "");
  const [ideology, setIdeology] = useState(settings.ideology ?? "");
  // Step 3 — codebase
  const [sourceDirs, setSourceDirs] = useState(settings.sourceDirs ?? "");
  const [scanned, setScanned] = useState<PolishdProjectProfile | null>(null);
  // Step 4 — GitHub
  const [githubRepo, setGithubRepo] = useState(settings.githubRepo ?? "");
  const [githubToken, setGithubToken] = useState("");
  const [githubStatus, setGithubStatus] = useState<PolishdGithubStatus | null>(null);
  const [autoIssues, setAutoIssues] = useState(settings.githubAutoIssues ?? false);
  // Step 5 — cadence
  const [cadence, setCadence] = useState<PolishdRefreshCadence>("manual");

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

  const connectGithub = () =>
    startStep(async () => {
      setError(null);
      const saved = await saveAISettingsAction({
        githubRepo,
        githubToken,
        githubAutoIssues: autoIssues,
      });
      onSettings(saved);
      setGithubToken("");
      const res = await verifyGithubAction();
      if (res.ok) setGithubStatus(res.status);
      else setError(res.message);
    });

  // The toggle stays visible after connecting — persist its latest state.
  const finishGithub = () =>
    startStep(async () => {
      onSettings(await saveAISettingsAction({ githubAutoIssues: autoIssues }));
      next();
    });

  const finish = () =>
    startStep(async () => {
      onSettings(await saveAISettingsAction({ refreshCadence: cadence }));
      const res = await generateSummaryAction(false);
      // The wizard is closing and the Analytics tab is about to render the
      // result — a failure has to surface on the tab that outlives it.
      if (!res.ok) onError(res.message);
      onFinished();
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
                onChange={(e) => setProvider(e.target.value as PolishdAIProvider)}
                className={`${inputCls} mt-1.5`}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <ModelField
              provider={provider}
              model={model}
              onModel={setModel}
              apiKey={apiKey}
              baseUrl={baseUrl}
              hasStoredKey={settings.hasApiKey && settings.provider === provider}
            />
            <label className="block sm:col-span-2">
              <span className={labelCls}>API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  settings.hasApiKey ? "•••••••• (stored — leave blank to keep)" : "Paste your key"
                }
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
            <button
              type="button"
              onClick={onSkip}
              className="text-[11px] text-[#555] hover:text-[#888]"
            >
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
              site&apos;s structure.
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
                <span className="ml-1 text-[11px] text-[#555]">
                  — optional; defaults to src / app / components / pages / lib.
                </span>
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
          title="Connect your GitHub repository"
          intro="Optional. With the repo connected, problems the model finds are verified against your actual source code — real ones become GitHub issues with the technical analysis and fix suggestions, false alarms are dropped. A fine-grained token scoped to just this repo is all it needs."
        >
          {githubStatus ? (
            <div className="rounded-md border border-emerald-900/50 bg-emerald-950/20 px-3 py-2.5 text-[12px] text-emerald-400">
              Connected to {githubStatus.repo} · default branch{" "}
              <code className="font-mono">{githubStatus.defaultBranch}</code>
              {!githubStatus.issuesEnabled && " · issues are disabled on this repo"}
              {!githubStatus.canPush && " · token can't push (branches/PRs unavailable)"}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Repository</span>
                <input
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="owner/repo"
                  className={`${inputCls} mt-1.5 font-mono`}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Access token</span>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder={
                    settings.hasGithubToken
                      ? "•••••••• (stored — leave blank to keep)"
                      : "github_pat_…"
                  }
                  autoComplete="off"
                  className={`${inputCls} mt-1.5`}
                />
                <span className="mt-1 block text-[11px] text-[#555]">
                  Create a{" "}
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[#888] underline decoration-[#444] underline-offset-2 hover:text-white"
                  >
                    fine-grained token
                  </a>{" "}
                  for this repo with Contents (read) and Issues &amp; Pull requests (write). Stored
                  server-side; never sent to the browser.
                </span>
              </label>
            </div>
          )}
          <label className="mt-4 flex max-w-xl cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={autoIssues}
              onChange={(e) => setAutoIssues(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-white"
            />
            <span>
              <span className="block text-[13px] font-medium text-white">
                Allow creating issues automatically
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-[#666]">
                Every new problem a summary finds is verified against the source and — when it holds
                up — filed as a GitHub issue on its own, with technical details and fix suggestions.
                The same problem is never filed twice.
              </span>
            </span>
          </label>
          <div className="mt-4 flex items-center gap-3">
            {githubStatus ? (
              <button type="button" onClick={finishGithub} disabled={pending} className={primaryBtn}>
                {pending ? "Saving…" : "Continue"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={connectGithub}
                  disabled={
                    pending || !githubRepo.trim() || (!githubToken && !settings.hasGithubToken)
                  }
                  className={primaryBtn}
                >
                  {pending ? "Connecting…" : "Connect GitHub"}
                </button>
                <button type="button" onClick={next} className={ghostBtn}>
                  Skip for now
                </button>
              </>
            )}
          </div>
        </StepShell>
      )}

      {step === 4 && (
        <StepShell
          step={4}
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

// ── The settled settings form ────────────────────────────────────────────────

/** One titled card in the settings stack. */
function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className={`mb-4 ${card} overflow-hidden`}>
      <div className={`border-b ${border} px-4 py-3 sm:px-5`}>
        <span className={labelCls}>{title}</span>
        <p className="mt-1 text-[12px] leading-relaxed text-[#666]">{hint}</p>
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function SettingsForm({
  settings,
  profile,
  gaps,
  sourceAvailable,
  onSaved,
  onProfile,
  onError,
}: {
  settings: PolishdAISettingsPublic;
  profile: PolishdProjectProfile | null;
  gaps: string[];
  sourceAvailable: boolean;
  onSaved: (next: PolishdAISettingsPublic) => void;
  onProfile: (p: PolishdProjectProfile) => void;
  onError: (msg: string) => void;
}) {
  const [provider, setProvider] = useState<PolishdAIProvider>(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? "");
  const [instructions, setInstructions] = useState(settings.instructions ?? "");
  const [context, setContext] = useState(settings.context ?? "");
  const [audience, setAudience] = useState(settings.audience ?? "");
  const [ideology, setIdeology] = useState(settings.ideology ?? "");
  const [sourceDirs, setSourceDirs] = useState(settings.sourceDirs ?? "");
  const [cadence, setCadence] = useState<PolishdRefreshCadence>(
    settings.refreshCadence ?? "manual",
  );
  const [githubRepo, setGithubRepo] = useState(settings.githubRepo ?? "");
  const [githubToken, setGithubToken] = useState("");
  const [autoIssues, setAutoIssues] = useState(settings.githubAutoIssues ?? false);
  const [saved, setSaved] = useState(false);
  const [pending, startSave] = useTransition();

  const prov = PROVIDERS.find((p) => p.value === provider);

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
        githubRepo,
        githubToken, // blank keeps the stored token
        githubAutoIssues: autoIssues,
      });
      onSaved(next);
      setApiKey("");
      setGithubToken("");
      setSaved(true);
    });
  };

  return (
    <>
      <Group
        title="Model"
        hint="Bring your own key. The same provider answers the analytics summary and the design review."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as PolishdAIProvider)}
              className={`${inputCls} mt-1.5`}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <ModelField
            provider={provider}
            model={model}
            onModel={setModel}
            apiKey={apiKey}
            baseUrl={baseUrl}
            hasStoredKey={settings.hasApiKey && settings.provider === provider}
          />

          <label className="block">
            <span className={labelCls}>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                settings.hasApiKey ? "•••••••• (stored — leave blank to keep)" : "Paste your key"
              }
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
              onChange={(e) => setCadence(e.target.value as PolishdRefreshCadence)}
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
      </Group>

      <Group
        title="Your site"
        hint="Context the model reads before it interprets a single number. Optional, and the story is noticeably sharper with it."
      >
        <label className="block">
          <span className={labelCls}>Site description</span>
          <span className="ml-1 text-[11px] text-[#555]">
            — what the site is, who it&apos;s for, key flows.
          </span>
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

        <label className="mt-4 block">
          <span className={labelCls}>Instructions</span>
          <span className="ml-1 text-[11px] text-[#555]">
            — optional: tone, focus, what to call out.
          </span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="e.g. Focus on conversion blockers. Keep it blunt."
            className={`${inputCls} mt-1.5 resize-y`}
          />
        </label>
      </Group>

      <Group
        title="Codebase"
        hint="One scan teaches the model your pages and components, and every later summary reuses it instead of re-reading code."
      >
        <ProfileStrip
          profile={profile}
          gaps={gaps}
          hasApiKey={settings.hasApiKey}
          sourceAvailable={sourceAvailable}
          onScanned={onProfile}
          onError={onError}
        />
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
      </Group>

      <Group
        title="GitHub"
        hint="Where findings go to get fixed. Problems are verified against the source first — false alarms never become issues."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Repository</span>
            <input
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="owner/repo"
              className={`${inputCls} mt-1.5 font-mono`}
            />
          </label>

          <label className="block">
            <span className={labelCls}>Access token</span>
            <span className="ml-1 text-[11px] text-[#555]">
              — Contents (read), Issues &amp; Pull requests (write).
            </span>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={
                settings.hasGithubToken ? "•••••••• (stored — leave blank to keep)" : "github_pat_…"
              }
              autoComplete="off"
              className={`${inputCls} mt-1.5`}
            />
          </label>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={autoIssues}
            onChange={(e) => setAutoIssues(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-white"
          />
          <span>
            <span className="block text-[13px] text-white">
              Allow creating issues automatically
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-[#666]">
              New problems are verified against the source, then filed on their own; never twice.
            </span>
          </span>
        </label>
      </Group>

      <div className="flex flex-wrap items-center gap-3 pb-4">
        <button type="button" onClick={save} disabled={pending} className={primaryBtn}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-[12px] text-emerald-400">Saved</span>}
        {settings.fromEnv && (
          <span className="text-[11px] text-[#555]">
            Defaults loaded from environment variables.
          </span>
        )}
      </div>
    </>
  );
}

// ── Project profile ──────────────────────────────────────────────────────────
function ProfileStrip({
  profile,
  gaps,
  hasApiKey,
  sourceAvailable,
  onScanned,
  onError,
}: {
  profile: PolishdProjectProfile | null;
  gaps: string[];
  hasApiKey: boolean;
  sourceAvailable: boolean;
  onScanned: (p: PolishdProjectProfile) => void;
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
    <div className={`rounded-md border ${border} bg-[#080808] px-3 py-2.5`}>
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
            <span className="max-w-md">
              {sourceAvailable
                ? "Not scanned yet."
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
