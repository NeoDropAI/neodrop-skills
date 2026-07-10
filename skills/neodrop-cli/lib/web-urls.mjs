// Neodrop frontend URL assembly: once a user has an id, they get a clickable web
// link directly.
//
// Why this lives in the skill rather than the backend response: URL paths
// (`/post/<id>` / `/channel/<id>` / `/user/<id>`) are a frontend rendering
// contract, not a data contract — `grain.id` is stable data; the frontend could
// change the route to `/post/<id>` tomorrow without the backend shipping a new
// API version. Baking routes into the response would make the backend depend
// backwards on frontend rendering. This is for CLI internal use, as a
// human-readable hint on stderr.
//
// Path source of truth = `apps/web/src/app/[locale]/<route>/[id]/page.tsx`:
//   post / grain  → `/post/<id>`
//   channel       → `/channel/<id>`
//   user          → `/user/<id>`
//
// Note: the CLI attaches no locale prefix (neodrop.ai uses
// localePrefix='as-needed', so the default locale `en` maps to the prefix-less
// path; other locales are handled by a client-side redirect based on user
// preference).

function strip(origin) {
  return origin.replace(/\/+$/, "");
}

export function postUrl(webOrigin, postId) {
  return `${strip(webOrigin)}/post/${postId}`;
}

export function channelUrl(webOrigin, channelId) {
  return `${strip(webOrigin)}/channel/${channelId}`;
}

export function userUrl(webOrigin, userId) {
  return `${strip(webOrigin)}/user/${userId}`;
}
