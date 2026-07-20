/** Minimal browser shim for Node's `url` module (used by `@x402/extensions`). */
export function domainToASCII(domain: string): string {
  return domain;
}

export function domainToUnicode(domain: string): string {
  return domain;
}

export function fileURLToPath(url: string | URL): string {
  return String(url);
}

export function pathToFileURL(path: string): URL {
  return new URL(path, "file://");
}

export default {
  domainToASCII,
  domainToUnicode,
  fileURLToPath,
  pathToFileURL,
};
