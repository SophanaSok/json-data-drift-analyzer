export async function hashText(input: string): Promise<string> {
  // SubtleCrypto only exists in secure contexts (HTTPS or localhost). Without
  // this check a plain-HTTP origin fails with a bare "Cannot read properties of
  // undefined" that says nothing about why.
  if (typeof crypto?.subtle?.digest !== "function") {
    throw new Error(
      "Hashing requires a secure context (HTTPS or localhost); this page was served over an origin where SubtleCrypto is unavailable."
    );
  }
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
