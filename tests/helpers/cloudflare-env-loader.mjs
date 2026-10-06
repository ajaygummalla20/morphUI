// Test-only binding seam: never loaded by the application or production worker.
const bindingsUrl = `data:text/javascript,${encodeURIComponent("export const env = {};")}`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: bindingsUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
