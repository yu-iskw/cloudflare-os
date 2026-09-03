export type RouteTarget = "kernel" | "gatekeeper" | "spa";

export type Route = {
  target: RouteTarget;
  slug?: string;
};

/**
 * Path routing for the Cloud Run origin: `/api` and screenshots to the kernel,
 * `/gatekeeper/<slug>/*` to a Gatekeeper service, everything else to the SPA.
 */
export function routePath(pathname: string): Route {
  if (pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/blueprint-screenshot")) {
    return { target: "kernel" };
  }
  const gk = /^\/gatekeeper\/([^/]+)(\/.*)?$/.exec(pathname);
  if (gk) return { target: "gatekeeper", slug: gk[1] };
  return { target: "spa" };
}
