import { useEffect } from "react";
import { useLocation } from "wouter";

function applyFavicons(isAdmin: boolean) {
  const set = (selector: string, href: string) => {
    const el = document.querySelector(selector) as HTMLLinkElement | null;
    if (el) el.href = href;
  };

  if (isAdmin) {
    set('link[rel="icon"][type="image/x-icon"]', "/favicon-admin.png");
    set('link[rel="icon"][sizes="32x32"]', "/favicon-admin.png");
    set('link[rel="icon"][sizes="16x16"]', "/favicon-admin.png");
    set('link[rel="apple-touch-icon"]', "/favicon-admin.png");
  } else {
    set('link[rel="icon"][type="image/x-icon"]', "/favicon.ico");
    set('link[rel="icon"][sizes="32x32"]', "/favicon-32x32.png");
    set('link[rel="icon"][sizes="16x16"]', "/favicon-16x16.png");
    set('link[rel="apple-touch-icon"]', "/apple-touch-icon.png");
  }
}

export function FaviconManager() {
  const [location] = useLocation();

  useEffect(() => {
    const isAdmin =
      location.startsWith("/admin") || location.startsWith("/super-admin");
    applyFavicons(isAdmin);
  }, [location]);

  return null;
}
