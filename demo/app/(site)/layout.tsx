import DemoBar from "@/components/demo-bar";
import Footer from "@/components/site/footer";
import Nav from "@/components/site/nav";
import { BOOT_SCRIPT } from "@/lib/fixes";

/** `NEXT_PUBLIC_DEMO_BAR=off` serves Queuebird alone, with no demo bar over it. */
const BAR = process.env.NEXT_PUBLIC_DEMO_BAR !== "off";

/** Queuebird itself — every page of the sample site — with the demo bar over it. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Before paint: keep the version (as generated / polished) chosen in this tab. */}
      <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      <div className="site-root min-h-svh overflow-x-clip bg-black pb-20 fx-palette:bg-canvas">
        <Nav />
        <main>{children}</main>
        <Footer />
      </div>
      {BAR ? <DemoBar /> : null}
    </>
  );
}
