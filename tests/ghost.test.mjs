// Unit tests for `src/lib/ghost.ts`, the Ghost Content API client behind the blog.
//
// The client is the only runnable code in `src/` (the rest is `.astro` templates
// and type declarations), and every page that lists posts depends on it: when the
// Content API is unreachable the blog silently falls back to the bundled sample
// posts. That fallback is a behaviour, not an accident, so it is pinned here
// instead of being discovered in production.
//
// The module reads `import.meta.env.GHOST_URL`/`GHOST_KEY` (Vite replaces them at
// build time) so the tests exercise the same code the site builds, with `fetch`
// and `console.error` stubbed per test — no network and no credentials.
//
// Run with `npm test` (node's built-in test runner) or `npm run coverage`
// (same suite through c8, which enforces the line floor in `.c8rc.json`).

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { getPostBySlug, getPosts } from '../src/lib/ghost.ts';

// Slugs of the bundled fallback posts, as rendered by the blog pages.
const FALLBACK_SLUGS = [
  'home-assistant-beginnen',
  'wifi-thuisnetwerk-optimaliseren',
  'slimme-verlichting-zonder-cloud',
];

const realFetch = globalThis.fetch;
const realConsoleError = console.error;

let requested = [];
let logged = [];

beforeEach(() => {
  requested = [];
  logged = [];
  // `console.error` is the client's only failure signal; capture it instead of
  // letting the suite print expected fallback noise.
  console.error = (...args) => logged.push(args);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
});

/** Answers with `payload` (HTTP 200) and remembers the URL it was asked for. */
function stubJson(payload, { ok = true, status = 200 } = {}) {
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return { ok, status, json: async () => payload };
  };
}

/** Fails the request the way a DNS/TLS/connection error does. */
function stubNetworkError(message) {
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    throw new Error(message);
  };
}

function postsPayload(posts) {
  return { posts, meta: { pagination: { page: 1, limit: posts.length, pages: 1, total: posts.length } } };
}

test('getPosts asks the Content API for the requested limit and returns its posts', async () => {
  const apiPosts = [{ id: 'api-1', slug: 'van-de-api' }, { id: 'api-2', slug: 'nog-een' }];
  stubJson(postsPayload(apiPosts));

  const posts = await getPosts(3);

  assert.deepEqual(posts, apiPosts);
  assert.equal(requested.length, 1);
  const url = new URL(requested[0]);
  assert.equal(url.origin, 'https://demo.ghost.io');
  assert.equal(url.pathname, '/ghost/api/content/posts/');
  assert.equal(url.searchParams.get('limit'), '3');
  assert.equal(url.searchParams.get('include'), 'tags');
  assert.ok(url.searchParams.get('key'), 'the Content API key must be sent');
  assert.deepEqual(logged, []);
});

test('getPosts defaults to ten posts', async () => {
  stubJson(postsPayload([]));

  await getPosts();

  assert.equal(new URL(requested[0]).searchParams.get('limit'), '10');
});

test('getPosts falls back to the bundled posts when the API answers non-2xx', async () => {
  stubJson({ message: 'Internal Server Error' }, { ok: false, status: 500 });

  const posts = await getPosts(12);

  assert.deepEqual(posts.map((post) => post.slug), FALLBACK_SLUGS);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'Ghost API error:');
  assert.equal(logged[0][1], 500);
});

test('getPosts falls back to the bundled posts when the request rejects', async () => {
  stubNetworkError('fetch failed');

  const posts = await getPosts(12);

  assert.deepEqual(posts.map((post) => post.slug), FALLBACK_SLUGS);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'Failed to fetch Ghost posts:');
  assert.match(String(logged[0][1].message), /fetch failed/);
});

test('getPostBySlug returns the post the API answers with', async () => {
  const apiPost = { id: 'api-9', slug: 'slimme-verlichting-zonder-cloud', title: 'Van de API' };
  stubJson(postsPayload([apiPost]));

  const post = await getPostBySlug('slimme-verlichting-zonder-cloud');

  assert.deepEqual(post, apiPost);
  const url = new URL(requested[0]);
  assert.equal(url.pathname, '/ghost/api/content/posts/slug/slimme-verlichting-zonder-cloud/');
  assert.ok(url.searchParams.get('key'), 'the Content API key must be sent');
  assert.deepEqual(logged, []);
});

test('getPostBySlug returns null when the API answers with no posts', async () => {
  stubJson(postsPayload([]));

  assert.equal(await getPostBySlug('bestaat-niet'), null);
});

test('getPostBySlug falls back to the matching bundled post on a non-2xx answer', async () => {
  stubJson({ message: 'Not Found' }, { ok: false, status: 404 });

  const post = await getPostBySlug('wifi-thuisnetwerk-optimaliseren');

  assert.equal(post.slug, 'wifi-thuisnetwerk-optimaliseren');
  assert.equal(post.reading_time, 5);
  assert.deepEqual(logged, [], 'a 404 is an answer, not a logged failure');
});

test('getPostBySlug returns null for an unknown slug on a non-2xx answer', async () => {
  stubJson({ message: 'Not Found' }, { ok: false, status: 404 });

  assert.equal(await getPostBySlug('bestaat-niet'), null);
});

test('getPostBySlug falls back to the matching bundled post when the request rejects', async () => {
  stubNetworkError('getaddrinfo ENOTFOUND');

  const post = await getPostBySlug('home-assistant-beginnen');

  assert.equal(post.slug, 'home-assistant-beginnen');
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'Failed to fetch Ghost post:');
});

test('getPostBySlug returns null for an unknown slug when the request rejects', async () => {
  stubNetworkError('getaddrinfo ENOTFOUND');

  assert.equal(await getPostBySlug('bestaat-niet'), null);
});
