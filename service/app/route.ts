/** GET / — a plain description, for anyone who opens the service's URL. */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(
    "polishd-shots — screenshots for @polishd/next's site snapshots.\n\n" +
      "POST /api/v1/shoot from a page shoots that page's own site (its Origin),\n" +
      "public pages only. Images are returned, never stored.\n" +
      "https://github.com/muskanvaswan/polishd/tree/main/service\n",
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
