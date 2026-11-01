# Analytics

spinner counts anonymous page views and a few events with
[GoatCounter](https://www.goatcounter.com/), in the shared `creynia` site
(`https://creynia.goatcounter.com`) that covers all of creynia.com.

## What is sent

One image request to `https://creynia.goatcounter.com/count` per page view or event, with:

| Param | Value |
| --- | --- |
| `p` | Route pattern (`/spinner/#/run/:runId`), static page path (`/spinner/strategies/`) or event name (`spinner:run-start`) |
| `t` | Event name, for events only (page views send no title) |
| `r` | Referrer, on the first view only and only when it is another site |
| `s` | Screen width |
| `e` | `true` for events |

No script is loaded, no cookie or local storage is used, and no identifier is sent. GoatCounter
derives the browser, OS and country from the request and does not store IP addresses. Nothing
from your library is ever sent: no run, definition or group ids, no strategy names, no query
strings, no results. Sync data still goes only between your browser and Google
([`docs/design/sync.md`](design/sync.md) §10).

## CSP

The beacon is an image, so the only change to the Content-Security-Policy is
`https://creynia.goatcounter.com` in `img-src`, both in the app (`build/vite-plugin-csp.ts`) and on
the static pages (`CSP_STATIC` in `build/static-pages.ts`). `script-src` and `connect-src` are
unchanged. `tests/build/csp.test.ts` and `tests/build/static-pages.test.ts` pin this.

## When it is off

`src/app/analytics.ts` sends nothing unless the page is served over https from `creynia.com`,
so dev, `vite preview`, unit and e2e tests and forks never count. It is also off when
`navigator.webdriver` is set or the browser sends Do Not Track or Global Privacy Control.
The static-page pixel cannot check these (the pages run no script); it counts on every host where
the page is served, which in practice is creynia.com.

## Page views and events

- **App:** one view per route change (`App.tsx`), counted as the matched route pattern from
  `src/app/routes.tsx` (`resolveRoute(...).pattern`), so `#/run/abc?x=1` counts as
  `/spinner/#/run/:runId`; unknown routes count as `/spinner/#/404`. Repeats are ignored.
- **Static pages** (`build/static-pages.ts`): a JS-free 1×1 pixel (`countPixel`) with the page path.
- **Events:**
  - `run-start`: the user starts a run from Define (Run).
  - `gallery-open`: a gallery bundle is opened and Analyze is shown.

Add an event with `trackEvent('name')`; keep names short and fixed, and never include user data
(ids, names, numbers typed in).
