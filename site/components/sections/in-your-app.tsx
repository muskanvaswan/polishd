import { SectionHead, Wrap, d } from "@/components/kit";

/**
 * What it physically is: code in your app, and here are the files. People
 * skimming the old page took Polishd for an agent skill, so this says it in
 * so many words. It sits directly under "Everything runs in your app", which
 * covers whose database, model and coding agent it uses; this section only
 * adds what lands in the repo.
 */
const FILES = [
  { path: "instrumentation-client.ts", note: "captures clicks, scrolls and vitals in the browser" },
  { path: "app/api/polishd/route.ts", note: "stores them in your database" },
  { path: "app/polishd/page.tsx", note: "your dashboard, behind your auth" },
  { path: "polishd.defaults.json", note: "what the site is, for the reviews" },
];

export default function InYourApp() {
  return (
    <section id="what" className="relative z-10 pb-24 md:pb-32">
      <Wrap>
        <div className="grid items-center gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14">
          <SectionHead
            lead={<>A package in your app.</>}
            title={<>Not a service. Not a skill.</>}
            sub={
              <>
                <code className="font-mono text-[0.92em] text-fg-2">npx @polishd/next init</code> writes three
                files into your Next.js app. Capture, storage and the dashboard all run there — on your
                infrastructure, under your auth, against your data.
              </>
            }
          />

          {/* The install, as a file tree. */}
          <div className="r card overflow-hidden" style={d(80)}>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              <span className="ml-2 font-mono text-[11.5px] text-fg-4">your-next-app/</span>
            </div>
            <div className="px-4 py-5 font-mono text-[12.5px] leading-[2] sm:px-6 sm:text-[13px]">
              <div className="text-fg-4">
                <span className="text-ok">$</span> <span className="text-fg">npx @polishd/next init</span>
              </div>
              <div className="text-fg-4">✓ Detected Next.js App Router</div>
              <div className="mt-3 text-fg-3">your-next-app/</div>
              {FILES.map((f, i) => (
                <div key={f.path} className="group flex flex-wrap items-baseline gap-x-3">
                  <span className="text-fg-4">{i === FILES.length - 1 ? "└─" : "├─"}</span>
                  <span className="text-fg">{f.path}</span>
                  <span className="text-fg-4 max-sm:basis-full max-sm:pl-7 max-sm:leading-[1.4]">
                    <span className="text-ok/80">+</span> {f.note}
                  </span>
                </div>
              ))}
              <div className="mt-3 text-fg-4">
                <span className="text-fg-3">├─</span> app/, components/, … <span className="text-fg-4">your code, untouched</span>
              </div>
              <div className="mt-4 border-t border-line pt-4 text-fg-4">
                <span className="text-ok">$</span> <span className="text-fg">npx @polishd/next doctor</span>
              </div>
              <div className="text-ok">✓ Capture, ingest and dashboard wired · store writable</div>
            </div>
          </div>
        </div>
      </Wrap>
    </section>
  );
}
