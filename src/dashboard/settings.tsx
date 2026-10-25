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
  PolishdDispatchState,
  PolishdGithubStatus,
  PolishdProjectProfile,
  PolishdRefreshCadence,
} from "../ai/types";
import DispatchCard, { type DispatchChoices } from "./dispatch-card";
import {
  Badge,
  Callout,
  CheckIcon,
  Code,
  PageHeader,
  StatusPill,
  card,
  cardHeader,
  cardTitleCls,
  fieldHintCls,
  fieldLabelCls as labelCls,
  ghostBtn,
  inputCls,
  primaryBtn,
  relTime,
  textLink,
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
            className={`mt-1.5 text-[12px] ${textLink}`}
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
            className={`mt-1.5 text-[12px] ${textLink} disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40`}
          >
            {pending ? "Loading models…" : "Load available models"}
          </button>
          {error && <span className="mt-1 block text-[12px] text-bad">{error}</span>}
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
  /** Whether the app's source tree is on disk here. A scan can also read the connected repo. */
  sourceAvailable: boolean;
  /** What the Fix dispatch card last found and tested. */
  initialDispatch: PolishdDispatchState;
}

export default function SettingsView({
  initialSettings,
  initialProfile,
  initialGaps,
  sourceAvailable,
  initialDispatch,
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
    // Coarse tag for polishd's own dashboard telemetry: any settings click
    // without a finer data-component groups under "settings" on the
    // collecting side. Inert for host apps.
    <main data-component="settings" className="text-fg">
      <PageHeader
        title="Settings"
        description={
          <>
            The model Polishd calls, what it knows about your site, and where it files what it
            finds. One model serves both the analytics summary and the design review.
          </>
        }
        actions={
          settings.hasApiKey ? (
            <StatusPill tone="ok">{settings.provider}</StatusPill>
          ) : (
            <StatusPill tone="neutral">No model</StatusPill>
          )
        }
      />

      {error && (
        <Callout tone="bad" className="mb-6">
          {error}
        </Callout>
      )}

      {onboarding ? (
        <section className={`${card} overflow-hidden`}>
          <div className={cardHeader}>
            <span className={cardTitleCls}>First-time setup</span>
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
          dispatch={initialDispatch}
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
// GitHub and the codebase scan share a step. Wherever the source isn't on disk
// — any deployed dashboard — the repo is what the scan reads, so the scan can
// only come after the token; and once the repo is connected, scanning it and
// filing issues to it are separate choices.
const STEPS = ["Model", "Your site", "GitHub & codebase", "Cadence"] as const;

/** " from owner/repo" for a profile read off GitHub; nothing for a disk scan. */
function profileFrom(profile: PolishdProjectProfile): string {
  const gh = profile.github;
  return gh ? ` from ${gh.repo}${gh.root ? `/${gh.root}` : ""}` : "";
}

/** One opt-in, as a checkbox row; a disabled row says what unlocks it. */
function OptionRow({
  checked,
  onChange,
  disabled = false,
  title,
  hint,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  title: string;
  hint: string;
  /** Shown under the row — e.g. the option's own settings. */
  children?: ReactNode;
}) {
  return (
    <div className={disabled ? "opacity-50" : undefined}>
      <label
        className={`flex max-w-xl items-start gap-2.5 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--pd-accent)] disabled:cursor-not-allowed"
        />
        <span>
          <span className="block text-[13px] font-medium text-fg">{title}</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-fg-3">{hint}</span>
        </span>
      </label>
      {children && <div className="mt-3 pl-6">{children}</div>}
    </div>
  );
}

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
    <div className="px-4 py-6 sm:px-6">
      <ol className="mb-6 flex flex-wrap items-center gap-2" aria-label="Setup steps">
        {STEPS.map((name, i) => (
          <li
            key={name}
            className="flex items-center gap-2"
            aria-current={i === step ? "step" : undefined}
          >
            <span
              className={`flex items-center gap-2 text-[12px] font-medium ${
                i === step ? "text-fg" : i < step ? "text-fg-2" : "text-fg-3"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                  i === step
                    ? "bg-accent text-accent-fg"
                    : i < step
                      ? "bg-ok/15 text-ok ring-1 ring-inset ring-ok/30"
                      : "bg-raised text-fg-3 ring-1 ring-inset ring-line-strong"
                }`}
              >
                {i < step ? <CheckIcon size={11} /> : i + 1}
              </span>
              {name}
            </span>
            {i < STEPS.length - 1 && (
              <span className={`h-px w-6 ${i < step ? "bg-ok/40" : "bg-line-strong"}`} />
            )}
          </li>
        ))}
      </ol>
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
      <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-fg-3">{intro}</p>
      <div className="mt-5">{children}</div>
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
  // Step 3 — GitHub & codebase
  const [githubRepo, setGithubRepo] = useState(settings.githubRepo ?? "");
  const [githubToken, setGithubToken] = useState("");
  const [githubStatus, setGithubStatus] = useState<PolishdGithubStatus | null>(null);
  const [scanOn, setScanOn] = useState(true);
  const [autoIssues, setAutoIssues] = useState(settings.githubAutoIssues ?? false);
  const [sourceDirs, setSourceDirs] = useState(settings.sourceDirs ?? "");
  const [scanned, setScanned] = useState<PolishdProjectProfile | null>(null);
  // Step 4 — cadence
  const [cadence, setCadence] = useState<PolishdRefreshCadence>("manual");

  const [pending, startStep] = useTransition();
  // Connecting has its own transition so its button, not the step's, says so.
  const [connecting, startConnect] = useTransition();
  const prov = PROVIDERS.find((p) => p.value === provider);

  // Each option unlocks with what it needs: the scan with any source to read
  // (the repo, or a tree on disk here), issues with a repo that takes them.
  const canScan = githubStatus !== null || sourceAvailable;
  const canFile = githubStatus !== null && githubStatus.issuesEnabled;
  const willScan = scanOn && canScan;

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

  const connectGithub = () =>
    startConnect(async () => {
      setError(null);
      const saved = await saveAISettingsAction({ githubRepo, githubToken });
      onSettings(saved);
      setGithubToken("");
      const res = await verifyGithubAction();
      if (res.ok) setGithubStatus(res.status);
      else setError(res.message);
    });

  // Apply the step's choices, then move on. A failed scan keeps the step open
  // so it can be retried — or switched off and skipped.
  const applyRepoStep = () =>
    startStep(async () => {
      setError(null);
      onSettings(
        await saveAISettingsAction({ sourceDirs, githubAutoIssues: autoIssues && canFile }),
      );
      if (willScan) {
        const res = await generateProfileAction();
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setScanned(res.profile);
        onProfile(res.profile);
      }
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
    <div>
      {error && (
        <Callout tone="bad" className="mx-4 mt-5 sm:mx-6">
          {error}
        </Callout>
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
                <span className="mt-1.5 block text-[12px] text-fg-3">
                  Get a key from{" "}
                  <a
                    href={prov.keyUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={textLink}
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
          <div className="mt-6 flex items-center gap-3">
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
              className="text-[12px] font-medium text-fg-3 transition-colors hover:text-fg"
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
          <div className="mt-6 flex items-center gap-3">
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
          title="Connect GitHub and scan your codebase"
          intro="Optional — one fine-grained token scoped to this repo covers both. The scan reads your source once, so every summary knows your pages and components; issues turn the problems the model finds into GitHub issues, verified against that same source. Connect the repo, then pick either or both."
        >
          {githubStatus ? (
            <Callout tone="ok">
              Connected to {githubStatus.repo} · default branch{" "}
              <Code>{githubStatus.defaultBranch}</Code>
              {!githubStatus.issuesEnabled && " · issues are disabled on this repo"}
              {!githubStatus.canPush && " · token can't push (branches/PRs unavailable)"}
            </Callout>
          ) : (
            <>
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
                  <span className="mt-1.5 block text-[12px] leading-relaxed text-fg-3">
                    Create a{" "}
                    <a
                      href="https://github.com/settings/personal-access-tokens/new"
                      target="_blank"
                      rel="noreferrer noopener"
                      className={textLink}
                    >
                      fine-grained token
                    </a>{" "}
                    for this repo with Contents (read) and Issues &amp; Pull requests (write).
                    Stored server-side; never sent to the browser.
                  </span>
                </label>
              </div>
              <button
                type="button"
                onClick={connectGithub}
                disabled={
                  connecting ||
                  pending ||
                  !githubRepo.trim() ||
                  (!githubToken && !settings.hasGithubToken)
                }
                className={`${primaryBtn} mt-4`}
              >
                {connecting ? "Connecting…" : "Connect GitHub"}
              </button>
            </>
          )}

          <div className="mt-6 space-y-4 border-t border-line pt-5">
            <OptionRow
              checked={willScan}
              onChange={setScanOn}
              disabled={!canScan}
              title="Scan the codebase"
              hint={
                sourceAvailable
                  ? "Reads the source on disk here once to learn your pages and components — this part works without GitHub. Cached in your database; re-scan from Settings when the site changes."
                  : githubStatus
                    ? `Reads ${githubStatus.repo} (${githubStatus.defaultBranch}) once to learn your pages and components. Cached in your database; re-scan from Settings when the site changes.`
                    : "Reads the repo's source once to learn your pages and components. Available once the repo is connected."
              }
            >
              {willScan && (
                <label className="block max-w-md">
                  <span className={labelCls}>Source folders</span>
                  <span className={`ml-1 ${fieldHintCls}`}>
                    — optional; defaults to src / app / components / pages / lib.
                  </span>
                  <input
                    value={sourceDirs}
                    onChange={(e) => setSourceDirs(e.target.value)}
                    placeholder="e.g. src, content"
                    className={`${inputCls} mt-1.5 font-mono`}
                  />
                </label>
              )}
            </OptionRow>
            <OptionRow
              checked={autoIssues && canFile}
              onChange={setAutoIssues}
              disabled={!canFile}
              title="Create issues automatically"
              hint={
                githubStatus && !githubStatus.issuesEnabled
                  ? "Issues are disabled on this repo — turn them on in its GitHub settings to use this."
                  : `Every new problem a summary finds is verified against the source and — when it holds up — filed as a GitHub issue on its own, with technical details and fix suggestions. The same problem is never filed twice.${githubStatus ? "" : " Available once the repo is connected."}`
              }
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {githubStatus ? (
              <button
                type="button"
                data-component={willScan ? "settings-scan-codebase" : undefined}
                onClick={applyRepoStep}
                disabled={pending}
                className={primaryBtn}
              >
                {pending
                  ? willScan
                    ? "Scanning your codebase…"
                    : "Saving…"
                  : willScan
                    ? "Scan & continue"
                    : "Continue"}
              </button>
            ) : willScan ? (
              <button
                type="button"
                data-component="settings-scan-codebase"
                onClick={applyRepoStep}
                disabled={pending || connecting}
                className={ghostBtn}
              >
                {pending ? "Scanning your codebase…" : "Scan & continue without GitHub"}
              </button>
            ) : (
              <button
                type="button"
                onClick={next}
                disabled={connecting}
                className={ghostBtn}
              >
                Skip for now
              </button>
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
          {scanned && (
            <Callout tone="ok" className="mb-5">
              Profiled {scanned.sourceFiles} files{profileFrom(scanned)} ·{" "}
              {scanned.coveredIdentifiers.length} components
              {scanned.truncated ? " (large app — clipped to budget)" : ""}. The model now knows your
              site&apos;s structure.
            </Callout>
          )}
          <div className="grid gap-2.5 sm:grid-cols-3">
            {CADENCES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCadence(c.value)}
                aria-pressed={cadence === c.value}
                className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  cadence === c.value
                    ? "border-accent/70 bg-accent/[0.07] ring-[3px] ring-accent/15"
                    : "border-line-strong bg-raised hover:border-fg-4"
                }`}
              >
                <span className="flex items-center justify-between text-[13px] font-medium text-fg">
                  {c.label}
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      cadence === c.value ? "border-accent bg-accent text-accent-fg" : "border-fg-4"
                    }`}
                  >
                    {cadence === c.value && <CheckIcon size={10} />}
                  </span>
                </span>
                <span className="mt-1 block text-[12px] leading-snug text-fg-3">{c.hint}</span>
              </button>
            ))}
          </div>
          <div className="mt-6">
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
    <section className={`mb-5 ${card} overflow-hidden`}>
      <div className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className={cardTitleCls}>{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">{hint}</p>
      </div>
      <div className="px-4 py-5 sm:px-5">{children}</div>
    </section>
  );
}

function SettingsForm({
  settings,
  profile,
  gaps,
  sourceAvailable,
  dispatch,
  onSaved,
  onProfile,
  onError,
}: {
  settings: PolishdAISettingsPublic;
  profile: PolishdProjectProfile | null;
  gaps: string[];
  sourceAvailable: boolean;
  dispatch: PolishdDispatchState;
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
  // The Fix dispatch card's choices live here so the one Save button covers them.
  const [dispatchChoices, setDispatchChoices] = useState<DispatchChoices>({
    auto: settings.dispatchAuto,
    label: settings.dispatchLabel,
    cap: String(settings.dispatchDailyCap),
    paused: settings.dispatchPaused,
  });
  const [saved, setSaved] = useState(false);
  const [pending, startSave] = useTransition();

  const prov = PROVIDERS.find((p) => p.value === provider);
  // The card only means something once there's a repo to look at.
  const dispatchRepo = settings.hasGithubToken ? settings.githubRepo : undefined;

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
        dispatchAuto: dispatchChoices.auto,
        dispatchLabel: dispatchChoices.label,
        dispatchDailyCap: Number(dispatchChoices.cap),
        dispatchPaused: dispatchChoices.paused,
      });
      // The server may have trimmed, defaulted or clamped: show what it kept.
      setDispatchChoices({
        auto: next.dispatchAuto,
        label: next.dispatchLabel,
        cap: String(next.dispatchDailyCap),
        paused: next.dispatchPaused,
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
              <span className="mt-1.5 block text-[12px] text-fg-3">
                Get a key from{" "}
                <a
                  href={prov.keyUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={textLink}
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
          <span className={`ml-1 ${fieldHintCls}`}>
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
          <span className={`ml-1 ${fieldHintCls}`}>
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
            <span className={`ml-1 ${fieldHintCls}`}>
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
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--pd-accent)]"
          />
          <span>
            <span className="block text-[13px] font-medium text-fg">
              Allow creating issues automatically
            </span>
            <span className="mt-0.5 block text-[12px] leading-snug text-fg-3">
              New problems are verified against the source, then filed on their own; never twice.
            </span>
          </span>
        </label>
      </Group>

      <Group
        title="Codebase"
        hint="One scan teaches the model your pages and components, and every later summary reuses it instead of re-reading code. It reads the source on disk here, or the connected GitHub repo where there isn't any."
      >
        <ProfileStrip
          profile={profile}
          gaps={gaps}
          settings={settings}
          sourceAvailable={sourceAvailable}
          onScanned={onProfile}
          onError={onError}
        />
        <label className="mt-4 block">
          <span className={labelCls}>Source folders</span>
          <span className={`ml-1 ${fieldHintCls}`}>
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

      {dispatchRepo && (
        <Group
          title="Fix dispatch"
          hint="The coding agent that takes filed issues off your hands — what the repo has and how a fix starts there, a live test of the wiring, and how much polishd may send. Create fix on the Actionables tab is where fixes are asked for."
        >
          <DispatchCard
            repo={dispatchRepo}
            initialState={dispatch}
            choices={dispatchChoices}
            onChoices={setDispatchChoices}
          />
        </Group>
      )}

      <div className="flex flex-wrap items-center gap-3 pb-4 pt-1">
        <button type="button" onClick={save} disabled={pending} className={primaryBtn}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved && (
          <span role="status" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ok">
            <CheckIcon size={13} />
            Saved
          </span>
        )}
        {settings.fromEnv && (
          <span className="text-[12px] text-fg-3">Defaults loaded from environment variables.</span>
        )}
      </div>
    </>
  );
}

// ── Project profile ──────────────────────────────────────────────────────────
function ProfileStrip({
  profile,
  gaps,
  settings,
  sourceAvailable,
  onScanned,
  onError,
}: {
  profile: PolishdProjectProfile | null;
  gaps: string[];
  /** The saved settings — a repo typed but not yet saved can't be scanned. */
  settings: PolishdAISettingsPublic;
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

  const repo = settings.hasGithubToken ? settings.githubRepo : undefined;
  const hasSource = sourceAvailable || !!repo;
  const canScan = settings.hasApiKey && hasSource && !pending;

  return (
    <div className="rounded-xl border border-line bg-sunken px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
          <span className="font-medium text-fg">Project profile</span>
          {profile ? (
            <>
              <span>
                scanned {relTime(profile.generatedAt)} · {profile.sourceFiles} files
                {profileFrom(profile)} · {profile.coveredIdentifiers.length} components
                {profile.truncated ? " · clipped to budget" : ""}
              </span>
              {gaps.length > 0 && (
                <Badge tone="warn">
                  {gaps.length} new {gaps.length === 1 ? "component" : "components"} not covered —
                  re-scan
                </Badge>
              )}
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className={textLink}
              >
                {expanded ? "Hide" : "View"}
              </button>
            </>
          ) : (
            <span className="max-w-md">
              {sourceAvailable
                ? "Not scanned yet."
                : repo
                  ? `Not scanned yet — the scan reads ${repo}.`
                  : "The source isn't on disk here — connect a GitHub repository above and the scan reads it from there."}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={!canScan}
          title={
            !settings.hasApiKey
              ? "Add an API key first"
              : !hasSource
                ? "Connect and save a GitHub repository first"
                : undefined
          }
          className={`${ghostBtn} h-7 px-2.5 text-[12px]`}
        >
          {pending ? "Scanning…" : profile ? "Re-scan codebase" : "Scan codebase"}
        </button>
      </div>
      {expanded && profile && (
        <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-[12.5px] leading-relaxed text-fg-2">
          {profile.text}
        </p>
      )}
    </div>
  );
}
