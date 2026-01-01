/* eslint-disable react/prop-types */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type React from "react";
import { useEffect, forwardRef } from "react";
import { AppProvider } from "@shopify/polaris";
import type { LinkLikeComponent, LinkLikeComponentProps } from "@shopify/polaris/build/ts/src/utilities/link";
import enTranslations from "@shopify/polaris/locales/en.json";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";

const PolarisLink = forwardRef<HTMLAnchorElement, LinkLikeComponentProps>(function PolarisLink(
  { url, onClick, target, children, ...rest },
  ref,
) {
  const navigate = useNavigate();
  const location = useLocation();
  const resolvedHref = url;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!resolvedHref || resolvedHref.startsWith("#")) return;
    if (target && target !== "_self") return;

    const nextUrl = new URL(resolvedHref, window.location.origin);
    if (nextUrl.origin !== window.location.origin) return;

    const host = new URLSearchParams(location.search).get("host");
    if (host && !nextUrl.searchParams.get("host")) {
      nextUrl.searchParams.set("host", host);
    }

    event.preventDefault();
    navigate(nextUrl.pathname + nextUrl.search + nextUrl.hash);
  };

  return (
    <a ref={ref} href={resolvedHref} target={target} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
});

function AppBridgeScript({ apiKey, host }: { apiKey: string; host: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const urlHost = new URLSearchParams(location.search).get("host");
    if (urlHost) {
      window.sessionStorage.setItem("shopify:host", urlHost);
    } else {
      const storedHost = window.sessionStorage.getItem("shopify:host");
      if (storedHost) {
        const nextUrl = new URL(window.location.href);
        if (!nextUrl.searchParams.get("host")) {
          nextUrl.searchParams.set("host", storedHost);
          navigate(nextUrl.pathname + nextUrl.search + nextUrl.hash, { replace: true });
          return;
        }
      }
    }

    const handleNavigate = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const href = target?.getAttribute?.("href");
      if (!href) return;

      const url = new URL(href, window.location.origin);
      if (urlHost && !url.searchParams.get("host")) {
        url.searchParams.set("host", urlHost);
      }
      navigate(url.pathname + url.search + url.hash);
    };

    document.addEventListener("shopify:navigate", handleNavigate as EventListener);
    return () => {
      document.removeEventListener("shopify:navigate", handleNavigate as EventListener);
    };
  }, [location.search, navigate]);

  return (
    <script
      src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
      data-api-key={apiKey}
      data-host={host ?? undefined}
      data-force-redirect="true"
    />
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const host = new URL(request.url).searchParams.get("host");

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", host };
};

export default function App() {
  const { apiKey, host } = useLoaderData<typeof loader>();

  return (
    <>
      <AppBridgeScript apiKey={apiKey} host={host} />
      <AppProvider i18n={enTranslations} linkComponent={PolarisLink as LinkLikeComponent}>
        <NavMenu>
          <a href="/app/rules">出荷ルール</a>
          <a href="/app/settings">設定</a>
        </NavMenu>
        <Outlet />
      </AppProvider>
    </>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
