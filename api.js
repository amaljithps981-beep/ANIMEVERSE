import { TMDB_API_KEY } from './config.js';

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w300';

/**
 * Helper to fetch JSON data from TMDB.
 */
async function tmdbFetch(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.append('api_key', TMDB_API_KEY);
  // Add language and other common params
  url.searchParams.append('language', 'en-US');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchTrending() {
  const data = await tmdbFetch('/trending/all/day');
  return data.results;
}

export async function fetchPopularMovies() {
  const data = await tmdbFetch('/movie/popular');
  return data.results;
}

export async function fetchPopularTV() {
  const data = await tmdbFetch('/tv/popular');
  return data.results;
}

export async function fetchTopRatedMovies() {
  const data = await tmdbFetch('/movie/top_rated');
  return data.results;
}

export async function searchMulti(query) {
  const data = await tmdbFetch('/search/multi', { query });
  // Filter to movies and tv only
  return data.results.filter(item => item.media_type === 'movie' || item.media_type === 'tv');
}

export function getPosterUrl(path) {
  return path ? `${IMAGE_BASE}${path}` : null;
}
