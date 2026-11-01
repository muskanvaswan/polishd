import { NPM_URL, REPO_URL, SITE_URL } from "@/lib/links";

// What a search result shows, so it says what Polishd is in the words people
// search for. The share card (openGraph in app/layout.tsx) keeps the pitch.
export const TITLE = "Polishd — Product analytics and design review for Next.js";
export const DESCRIPTION =
  "Open-source analytics and design review for Next.js. Polishd finds the rough edges in " +
  "your app, files them as bugs and hands each fix to your coding agent.";

export const AUTHOR = { name: "Muskan Vaswan", url: "https://github.com/muskanvaswan" };

/** schema.org JSON-LD for the landing page: the site, and the package it's for. */
export const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Polishd",
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "Polishd",
      alternateName: "@polishd/next",
      description: DESCRIPTION,
      url: SITE_URL,
      image: `${SITE_URL}/opengraph-image.png`,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Node.js 22.5+",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      license: "https://opensource.org/licenses/MIT",
      author: { "@type": "Person", ...AUTHOR },
      sameAs: [REPO_URL, NPM_URL],
    },
  ],
};
