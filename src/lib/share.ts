/**
 * Share a page of this site: the phone's share sheet where there is one,
 * otherwise copy the link. Uses the current origin, so it follows whichever
 * domain the visitor is on.
 */
export async function sharePage(path: string, title: string, text?: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = new URL(path, window.location.origin).toString();
  if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

/** What a shared secret says, besides the link (the link's preview card carries the rest). */
export function shareTextFor(name: string): string {
  return `How to find ${name} in GTA 6, on a talking map of Leonida`;
}
