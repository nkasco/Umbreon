export function safeParseUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/**
 * Check if a URL's hostname matches a rule domain (including subdomains).
 * @param {string} ruleDomain - The domain from the rule (e.g., "espn.com")
 * @param {string} urlDomain - The hostname from the URL (e.g., "www.espn.com")
 * @returns {boolean}
 */
function domainMatches(ruleDomain, urlDomain) {
  const rule = ruleDomain.toLowerCase();
  const target = urlDomain.toLowerCase();
  // Exact match
  if (rule === target) return true;
  // Subdomain match: target ends with ".rule"
  return target.endsWith('.' + rule);
}

export function getOrigin(rawUrl) {
  const url = safeParseUrl(rawUrl);
  return url ? url.origin : null;
}

export function getPageKey(rawUrl) {
  const url = safeParseUrl(rawUrl);
  if (!url) return null;
  // ignore hash so SPA routes don't explode the list
  return `${url.origin}${url.pathname}${url.search}`;
}

export function normalizeRuleInput(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;

  // Accept origin, full URL, or a prefix. If it's a bare domain, coerce to https://domain
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  const url = safeParseUrl(candidate);
  if (!url) return null;

  // Store as origin by default; users can include path if they want prefix matching
  if (trimmed.includes("/") && trimmed.includes("://")) {
    return trimmed;
  }

  return url.origin;
}

export function ruleMatchesUrl(ruleValue, rawUrl) {
  const url = safeParseUrl(rawUrl);
  if (!url) return false;

  // Exact-origin match
  if (ruleValue === url.origin) return true;

  // Prefix match against full href
  if (url.href.startsWith(ruleValue)) return true;

  // Domain matching (handles subdomains)
  // Parse the rule as a URL to extract its hostname
  const ruleUrl = safeParseUrl(ruleValue);
  if (ruleUrl && domainMatches(ruleUrl.hostname, url.hostname)) {
    return true;
  }

  return false;
}
