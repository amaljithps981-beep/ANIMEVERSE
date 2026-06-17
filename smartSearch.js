import { db, doc, setDoc, awaitWithTimeout, syncStorageToDb, getPreferences } from './db.js';
import { increment, collection, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getExcludedTitles } from './recommendations.js';
import { TMDB_API_BASE, TMDB_API_KEY, TMDB_IMAGE_BASE } from './config.js';

const TMDB_API = TMDB_API_BASE;
const TMDB_KEY = TMDB_API_KEY;
const IMG_PATH = TMDB_IMAGE_BASE;

// Sibling/Associated Genre Mappings
const GENRE_MAPS = {
    'action': 28, 'adventure': 12, 'comedy': 35, 'drama': 18, 'fantasy': 14,
    'horror': 27, 'mystery': 9648, 'romance': 10749, 'sci-fi': 878, 'thriller': 53,
    'animation': 16, 'family': 10751
};
const TV_GENRE_MAPS = {
    'action': 10759, 'adventure': 10759, 'comedy': 35, 'drama': 18, 'fantasy': 10765,
    'horror': 9648, 'mystery': 9648, 'romance': 10766, 'sci-fi': 10765, 'thriller': 53,
    'animation': 16, 'family': 10751
};
const JIKAN_GENRE_MAPS = {
    'action': 1, 'adventure': 2, 'comedy': 4, 'fantasy': 10, 'horror': 14, 
    'romance': 22, 'sci-fi': 24, 'dark': 14, 'slice of life': 36, 'sports': 30,
    'mystery': 7, 'drama': 8, 'family': 8
};

const GENRE_ID_TO_NAME = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    18: "Drama", 14: "Fantasy", 27: "Horror", 9648: "Mystery", 10749: "Romance",
    878: "Sci-Fi", 53: "Thriller", 10759: "Action & Adventure", 10765: "Sci-Fi & Fantasy",
    10766: "Romance", 10751: "Family", 36: "History", 10402: "Music",
    10752: "War", 37: "Western", 99: "Documentary"
};

// Local Search Cache to limit API calls (API level)
const _searchCache = new Map();

// Query level cache (final cards caching)
const _smartSearchCache = new Map();

/**
 * PART B & C: Intent Detection and Entity Extraction
 */
export function parseNlQuery(queryText) {
    const q = queryText.toLowerCase().trim();
    
    // 1. Extract Genre
    let genre = null;
    const genres = Object.keys(GENRE_MAPS);
    for (const g of genres) {
        if (q.includes(g)) {
            genre = g;
            break;
        }
    }
    // Sibling and colloquial aliases
    const colloquialGenreKeywords = {
        'romance': ['love', 'romantic', 'couple', 'marriage', 'girlfriend', 'boyfriend', 'heart'],
        'comedy': ['funny', 'hilarious', 'laugh', 'humor', 'joke'],
        'horror': ['scary', 'spooky', 'ghost', 'spirit', 'demon', 'zombie', 'dark'],
        'sci-fi': ['scifi', 'science fiction', 'space', 'robot', 'future', 'futuristic'],
        'slice of life': ['daily life', 'school life', 'relaxing', 'calm'],
        'action': ['fight', 'war', 'battle', 'combat', 'sword'],
        'adventure': ['journey', 'quest', 'explore', 'world'],
        'fantasy': ['magic', 'supernatural', 'isekai', 'another world'],
        'mystery': ['detective', 'puzzle', 'solve', 'crime'],
        'drama': ['sad', 'emotional', 'tear', 'cry'],
        'thriller': ['suspense', 'psychological', 'mind'],
        'sports': ['game', 'gaming', 'athlete', 'soccer', 'basketball', 'baseball']
    };
    for (const [g, keywords] of Object.entries(colloquialGenreKeywords)) {
        if (keywords.some(kw => q.includes(kw))) {
            genre = g;
            break;
        }
    }

    // 2. Extract Media Type
    let mediaType = null;
    if (q.includes("anime")) {
        mediaType = "anime";
    } else if (q.includes("movie") || q.includes("film") || q.includes("movies")) {
        mediaType = "movie";
    } else if (q.includes("tv") || q.includes("series") || q.includes("show") || q.includes("shows")) {
        mediaType = "tv";
    }

    // 3. Extract Rating Preference
    let best = false;
    if (q.includes("best") || q.includes("top-rated") || q.includes("top rated") || q.includes("highest rated")) {
        best = true;
    }

    // 4. Extract Length/Duration Preference
    let short = false;
    if (q.includes("short") || q.includes("quick") || q.includes("shorter")) {
        short = true;
    }

    // 5. Similar Content Check (Naruto, Interstellar, etc.)
    const similarMatch = q.match(/(?:like|similar to|resemble) ([a-z0-9\s\-\:\'\,\!\.]+)/i);
    let similarTitle = null;
    if (similarMatch && similarMatch[1]) {
        // Strip out type/genre/noise words to get clean title seed
        similarTitle = similarMatch[1]
            .replace(/(anime|movie|tv series|tv show|show|series|films|movies)/gi, "")
            .trim();
    }

    // 6. Intent Classification
    let intent = "general_search";
    if (similarTitle) {
        intent = "similar_content";
    } else if (genre) {
        intent = "genre_search";
    } else if (best) {
        intent = "rating_search";
    } else if (q.includes("trending") || q.includes("popular") || q.includes("hot") || q.includes("rising")) {
        intent = "trending_search";
    } else if (q.includes("recommend") || q.includes("suggest") || q.includes("watch") || q.includes("find me") || q.includes("show me")) {
        intent = "recommendation_search";
    }

    return { genre, mediaType, best, short, similarTitle, intent };
}

/**
 * Helper to fetch from TMDB or Jikan API
 */
async function fetchFromApi(url) {
    if (_searchCache.has(url)) {
        return _searchCache.get(url);
    }
    try {
        const res = await fetch(url).then(r => r.json());
        _searchCache.set(url, res);
        return res;
    } catch (e) {
        console.error("[Smart Search] API Fetch failed:", url, e);
        return null;
    }
}

/**
 * PART D: Smart Search Engine
 */
export async function performSmartSearch(queryText, user) {
    const q = queryText.toLowerCase().trim();
    
    // Check final query-level cache first
    const cacheKey = `${user ? user.uid : 'anonymous'}:${q}`;
    if (_smartSearchCache.has(cacheKey)) {
        console.log(`[Smart Search] Cache hit for query: "${q}"`);
        return _smartSearchCache.get(cacheKey);
    }

    const parsed = parseNlQuery(queryText);
    
    // Log impressions to Firestore
    trackSearchImpression(queryText);

    let results = [];
    let textExplanation = `AI Search Results for "${queryText}":`;

    try {
        if (parsed.intent === "similar_content" && parsed.similarTitle) {
            // Similarity Search
            const seed = parsed.similarTitle;
            const searchUrl = `${TMDB_API}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(seed)}`;
            const searchRes = await fetchFromApi(searchUrl);
            
            if (searchRes && searchRes.results && searchRes.results.length > 0) {
                const match = searchRes.results[0];
                const type = match.media_type || (match.first_air_date ? 'tv' : 'movie');
                
                const isAnime = type === 'anime' || (match.genre_ids && match.genre_ids.includes(16)) || parsed.mediaType === 'anime' || queryText.includes("anime");
                
                if (isAnime) {
                    const jikanUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(seed)}`;
                    const jikanRes = await fetchFromApi(jikanUrl);
                    if (jikanRes && jikanRes.data && jikanRes.data.length > 0) {
                        const first = jikanRes.data[0];
                        const jrecsUrl = `https://api.jikan.moe/v4/anime/${first.mal_id}/recommendations`;
                        const jrecs = await fetchFromApi(jrecsUrl);
                        results = (jrecs?.data || []).map(r => ({
                            title: r.entry.title,
                            poster_path: r.entry.images?.jpg?.large_image_url || r.entry.images?.jpg?.image_url || '',
                            vote_average: 8.0,
                            mediaType: 'anime',
                            mal_id: r.entry.mal_id
                        }));
                    }
                } else {
                    const recsUrl = `${TMDB_API}/${type}/${match.id}/recommendations?api_key=${TMDB_KEY}`;
                    const recsRes = await fetchFromApi(recsUrl);
                    results = (recsRes?.results || []).map(r => ({ ...r, mediaType: type }));
                }
            }
            textExplanation = `Here are titles similar to **${parsed.similarTitle.toUpperCase()}**:`;

        } else if (parsed.intent === "genre_search" && parsed.genre) {
            // Genre search
            if (parsed.mediaType === 'anime' || (!parsed.mediaType && queryText.includes("anime"))) {
                const gid = JIKAN_GENRE_MAPS[parsed.genre];
                let url = `https://api.jikan.moe/v4/anime?genres=${gid}&order_by=score&sort=desc`;
                if (parsed.short) url += `&type=movie`;
                const res = await fetchFromApi(url);
                results = (res?.data || []).map(item => ({
                    title: item.title,
                    poster_path: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '',
                    vote_average: item.score || 7.5,
                    mediaType: 'anime',
                    mal_id: item.mal_id,
                    genres: [parsed.genre]
                }));
            } else {
                const type = parsed.mediaType || 'movie';
                const gid = type === 'movie' ? GENRE_MAPS[parsed.genre] : TV_GENRE_MAPS[parsed.genre];
                let url = `${TMDB_API}/discover/${type}?api_key=${TMDB_KEY}&with_genres=${gid}`;
                if (parsed.best) url += `&sort_by=vote_average.desc&vote_count.gte=500`;
                else url += `&sort_by=popularity.desc`;
                
                const res = await fetchFromApi(url);
                results = (res?.results || []).map(r => ({ ...r, mediaType: type }));
            }
            textExplanation = `Showing best matching **${parsed.genre.toUpperCase()}** titles:`;

        } else if (parsed.intent === "rating_search" || parsed.best) {
            // Top Rated Search
            const movieUrl = `${TMDB_API}/movie/top_rated?api_key=${TMDB_KEY}`;
            const movieRes = await fetchFromApi(movieUrl);
            const tmdbResults = (movieRes?.results || []).map(r => ({ ...r, mediaType: 'movie' }));
            
            const animeUrl = `https://api.jikan.moe/v4/top/anime?filter=bypopularity`;
            const animeRes = await fetchFromApi(animeUrl);
            const animeResults = (animeRes?.data || []).map(item => ({
                title: item.title,
                poster_path: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '',
                vote_average: item.score || 8.0,
                mediaType: 'anime',
                mal_id: item.mal_id
            }));
            
            results = [...tmdbResults, ...animeResults];
            textExplanation = `Here are the highest-rated titles on AnimeVerse:`;

        } else if (parsed.intent === "trending_search") {
            // Trending Search
            const tmdbUrl = `${TMDB_API}/trending/all/week?api_key=${TMDB_KEY}`;
            const tmdbRes = await fetchFromApi(tmdbUrl);
            const tmdbResults = (tmdbRes?.results || []).map(r => ({
                ...r,
                mediaType: r.media_type || (r.first_air_date ? 'tv' : 'movie')
            }));
            
            const animeUrl = `https://api.jikan.moe/v4/top/anime?filter=bypopularity`;
            const animeRes = await fetchFromApi(animeUrl);
            const animeResults = (animeRes?.data || []).map(item => ({
                title: item.title,
                poster_path: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '',
                vote_average: item.score || 8.0,
                mediaType: 'anime',
                mal_id: item.mal_id
            }));
            
            results = [...tmdbResults, ...animeResults];
            textExplanation = `Here are the trending titles right now:`;

        } else if (parsed.intent === "recommendation_search") {
            // Personalized Recommendation Search
            let candidatePool = [];
            if (user) {
                try {
                    const recRef = doc(db, "recommendations", user.uid);
                    const recSnap = await getDoc(recRef);
                    if (recSnap.exists()) {
                        const recs = recSnap.data();
                        const recsPool = recs.recommendedForYou || [];
                        const watchPool = recs.becauseYouWatchAnime?.items || [];
                        const favPool = recs.similarToFavorites?.items || [];
                        const genrePool = recs.trendingInGenres?.items || [];
                        candidatePool = [...recsPool, ...watchPool, ...favPool, ...genrePool];
                    }
                } catch (e) {
                    console.warn("[Smart Search] Failed to fetch cached recommendations:", e);
                }
            }
            
            // If empty pool, fallback to trending
            if (candidatePool.length === 0) {
                const tmdbUrl = `${TMDB_API}/trending/all/week?api_key=${TMDB_KEY}`;
                const tmdbRes = await fetchFromApi(tmdbUrl);
                const tmdbResults = (tmdbRes?.results || []).map(r => ({
                    ...r,
                    mediaType: r.media_type || (r.first_air_date ? 'tv' : 'movie')
                }));
                candidatePool = tmdbResults;
            }
            
            results = candidatePool;
            textExplanation = `Personalized recommendations matching your profile:`;

        } else {
            // Text Search Fallback
            const tmdbUrl = `${TMDB_API}/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(queryText)}`;
            const tmdbRes = await fetchFromApi(tmdbUrl);
            const tmdbResults = (tmdbRes?.results || []).map(r => ({
                ...r,
                mediaType: r.media_type || (r.first_air_date ? 'tv' : 'movie')
            }));

            let animeResults = [];
            try {
                const jikanUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(queryText)}`;
                const jikanRes = await fetchFromApi(jikanUrl);
                animeResults = (jikanRes?.data || []).map(item => ({
                    title: item.title,
                    poster_path: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '',
                    vote_average: item.score || 7.5,
                    mediaType: 'anime',
                    mal_id: item.mal_id
                }));
            } catch (e) {
                console.warn("[Smart Search] Jikan fallback search failed:", e);
            }

            results = [...tmdbResults, ...animeResults];
        }

        // Retrieve user preferences and exclusions for scoring/filtering
        const prefs = await getPreferences().catch(() => null);
        const exclusions = await getExcludedTitles().catch(() => new Set());

        // Apply scoring weight
        const scored = [];
        const seenKeys = new Set();

        for (const item of results) {
            if (!item) continue;
            const title = item.title || item.name || '';
            if (!title) continue;

            const key = item.mal_id ? `anime_${item.mal_id}` : `tmdb_${item.id}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);

            // Filter out excluded / hidden titles
            if (exclusions.has(title.toLowerCase().trim())) continue;

            let score = 0;
            const rating = parseFloat(item.vote_average || item.score || 0);

            // Genre extraction for candidate item
            let itemGenres = [];
            if (Array.isArray(item.genres)) {
                itemGenres = item.genres.map(g => typeof g === 'object' ? (g.name || '') : g).filter(Boolean);
            } else if (item.genre_ids) {
                itemGenres = item.genre_ids.map(id => GENRE_ID_TO_NAME[id]).filter(Boolean);
            } else if (item.genres) {
                itemGenres = item.genres.map(g => g.name || g);
            }

            // 1. Explicit Genre match score (+100)
            if (parsed.genre) {
                const queryGenreLower = parsed.genre.toLowerCase();
                const hasGenreMatch = itemGenres.some(g => g.toLowerCase().includes(queryGenreLower));
                if (hasGenreMatch) {
                    score += 100;
                }
            }
            
            // 2. Explicit Media Type match score (+50)
            if (parsed.mediaType) {
                if (parsed.mediaType === 'anime' && item.mediaType === 'anime') {
                    score += 50;
                } else if (parsed.mediaType === 'movie' && item.mediaType === 'movie') {
                    score += 50;
                } else if (parsed.mediaType === 'tv' && (item.mediaType === 'tv' || item.mediaType === 'series')) {
                    score += 50;
                }
            }

            // 3. Rating weight
            if (parsed.best) {
                score += rating * 8; // prioritize higher rated
            } else {
                score += rating * 3;
            }

            // 4. Length/Duration preference (+40)
            if (parsed.short) {
                if (item.mediaType === 'movie') {
                    score += 40;
                }
            }

            // 5. User Profile Personalization (Top Genres & Favorite Type)
            if (prefs) {
                const topGenres = prefs.topGenres || [];
                const favType = (prefs.favoriteType || 'anime').toLowerCase();

                // User Top Genres match (+25 per genre match)
                topGenres.forEach(tg => {
                    if (itemGenres.some(g => g.toLowerCase().includes(tg.toLowerCase()))) {
                        score += 25;
                    }
                });

                // User Favorite Media Type match (+15)
                if (favType === 'anime' && item.mediaType === 'anime') {
                    score += 15;
                } else if (favType === 'movie' && item.mediaType === 'movie') {
                    score += 15;
                } else if ((favType === 'tv' || favType === 'series') && (item.mediaType === 'tv' || item.mediaType === 'series')) {
                    score += 15;
                }
            }

            scored.push({ item, score });
        }

        // Sort by scores descending
        scored.sort((a, b) => b.score - a.score);

        // Format to UI cards layout
        const cards = scored.map(s => {
            const item = s.item;
            const title = item.title || item.name || '';
            const rating = item.vote_average || item.score || 'N/A';
            const imgUrl = item.poster_path ? (item.poster_path.startsWith('http') ? item.poster_path : `${IMG_PATH}${item.poster_path}`) : '';
            
            // Format genre string
            let genreStr = 'N/A';
            if (Array.isArray(item.genres)) {
                genreStr = item.genres.map(g => typeof g === 'object' ? g.name : g).join(', ');
            } else if (item.genre_ids) {
                genreStr = item.genre_ids.map(id => GENRE_ID_TO_NAME[id] || GENRE_MAPS[id]).filter(Boolean).join(', ');
            }
            if (!genreStr || genreStr === 'N/A') {
                genreStr = parsed.genre ? parsed.genre.toUpperCase() : 'Media';
            }

            return {
                title,
                image: imgUrl,
                rating: typeof rating === 'number' ? rating.toFixed(1) : rating,
                id: item.id || item.mal_id || '',
                mediaType: item.mediaType || 'movie',
                genres: genreStr
            };
        });

        // Log search success status
        logSearchStatus(queryText, cards.length > 0);

        const response = {
            text: textExplanation,
            cards: cards.slice(0, 10)
        };

        // Cache the final results
        _smartSearchCache.set(cacheKey, response);

        return response;

    } catch (e) {
        console.error("[Smart Search] Execution error:", e);
        logSearchStatus(queryText, false);
        return { text: "Failed to load matching search results.", cards: [] };
    }
}

/**
 * PART G: Search Analytics logs
 */
async function trackSearchImpression(query) {
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        const ref = doc(db, "searchAnalytics", dateStr);
        const q = query.toLowerCase().trim().replace(/[\.\#\$\/\[\]]/g, "_");
        await setDoc(ref, {
            [`impressions.${q}`]: increment(1)
        }, { merge: true });
    } catch (e) {
        console.warn("[Smart Search] Failed to track impressions:", e);
    }
}

export async function trackSearchClick(query) {
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        const ref = doc(db, "searchAnalytics", dateStr);
        const q = query.toLowerCase().trim().replace(/[\.\#\$\/\[\]]/g, "_");
        await setDoc(ref, {
            [`clicks.${q}`]: increment(1)
        }, { merge: true });
    } catch (e) {
        console.warn("[Smart Search] Failed to track click:", e);
    }
}

async function logSearchStatus(query, success) {
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        const ref = doc(db, "searchAnalytics", dateStr);
        const q = query.toLowerCase().trim().replace(/[\.\#\$\/\[\]]/g, "_");
        
        const updates = {};
        if (success) {
            updates[`successful.${q}`] = increment(1);
        } else {
            updates[`failed.${q}`] = increment(1);
        }
        await setDoc(ref, updates, { merge: true });
    } catch (e) {
        console.warn("[Smart Search] Failed to log status:", e);
    }
}

/**
 * PART G & H: Fetch popular / trending searches dynamically
 */
export async function getDynamicSearchTags() {
    try {
        const querySnapshot = await awaitWithTimeout(getDocs(collection(db, "searchAnalytics")), 1500);
        const impressionsMap = {};
        const clicksMap = {};
        
        if (querySnapshot) {
            querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.impressions) {
                Object.entries(data.impressions).forEach(([query, count]) => {
                    impressionsMap[query] = (impressionsMap[query] || 0) + count;
                });
            }
            if (data.clicks) {
                Object.entries(data.clicks).forEach(([query, count]) => {
                    clicksMap[query] = (clicksMap[query] || 0) + count;
                });
            }
            });
        }

        const parseQueryKey = (key) => key.replace(/_/g, " ");

        // Popular: queries sorted by impressions descending
        const sortedPopular = Object.entries(impressionsMap)
            .sort((a, b) => b[1] - a[1])
            .map(([query]) => parseQueryKey(query));

        // Trending: queries sorted by CTR or click volume
        const sortedTrending = Object.entries(clicksMap)
            .sort((a, b) => b[1] - a[1])
            .map(([query]) => parseQueryKey(query));

        return {
            popular: sortedPopular.slice(0, 5),
            trending: sortedTrending.slice(0, 5)
        };
    } catch (e) {
        console.warn("[Smart Search] Failed to get dynamic tags:", e);
        return null;
    }
}

/**
 * PART H: Homepage popular / trending searches binding
 */
export async function loadSearchTags() {
    const popularGrid = document.getElementById("popularSearchesGrid");
    const trendingGrid = document.getElementById("trendingSearchesGrid");
    const searchInput = document.getElementById("search");
    
    if (!popularGrid || !trendingGrid) return;

    let popularTags = ["Best action anime", "Funny series to watch with family", "Short romance anime"];
    let trendingTags = ["Dark anime like Attack on Titan", "Movies similar to Interstellar", "Top rated horror movies"];

    // Try to load dynamically from searchAnalytics collection
    const dynamic = await getDynamicSearchTags();
    if (dynamic) {
        if (dynamic.popular.length > 0) popularTags = dynamic.popular;
        if (dynamic.trending.length > 0) trendingTags = dynamic.trending;
    }

    const renderTags = (tags, container) => {
        container.innerHTML = "";
        tags.forEach(tag => {
            const pill = document.createElement("button");
            pill.style.cssText = "background: rgba(255,255,255,0.05); color:#fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 6px 15px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s;";
            
            // Format tag beautifully
            const formattedTag = tag.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
            pill.innerText = formattedTag;
            
            pill.addEventListener("mouseover", () => {
                pill.style.background = "#e50914";
                pill.style.borderColor = "#e50914";
            });
            pill.addEventListener("mouseleave", () => {
                pill.style.background = "rgba(255,255,255,0.05)";
                pill.style.borderColor = "rgba(255,255,255,0.1)";
            });

            pill.addEventListener("click", () => {
                if (searchInput) {
                    searchInput.value = formattedTag;
                    searchInput.focus();
                    
                    // Trigger keyup search event on input
                    const event = new Event('keyup');
                    searchInput.dispatchEvent(event);
                }
            });
            container.appendChild(pill);
        });
    };

    renderTags(popularTags.slice(0, 5), popularGrid);
    renderTags(trendingTags.slice(0, 5), trendingGrid);
}

// Debounce helper
export function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Handle debounced input triggers and suggestions overlays
 */
export const triggerSmartSuggestions = debounce(async (query, containerElement) => {
    if (!containerElement) return;
    if (query.length < 2) {
        containerElement.innerHTML = "";
        containerElement.classList.add("hidden");
        return;
    }

    try {
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
        const auth = getAuth();
        const user = auth.currentUser;

        const searchRes = await performSmartSearch(query, user);
        containerElement.innerHTML = "";

        if (searchRes.cards && searchRes.cards.length > 0) {
            containerElement.classList.remove("hidden");
            
            // Header panel showing NLP intent category
            const header = document.createElement("div");
            header.style.cssText = "padding: 8px 15px; font-size:11px; color:#aaa; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.25); font-weight:600; text-transform: uppercase; letter-spacing: 0.5px;";
            
            const parsed = parseNlQuery(query);
            const intentLabels = {
                genre_search: "Genre Search",
                similar_content: "Similar Content Search",
                rating_search: "Rating Search",
                trending_search: "Trending Search",
                recommendation_search: "Recommendation Search",
                general_search: "General Search"
            };
            header.innerText = `💡 Detected Intent: ${intentLabels[parsed.intent] || "Search"}`;
            containerElement.appendChild(header);

            searchRes.cards.slice(0, 5).forEach(card => {
                const itemDiv = document.createElement("div");
                itemDiv.classList.add("search-item");
                itemDiv.innerHTML = `
                    <img src="${card.image || 'https://via.placeholder.com/200x300'}" alt="${card.title}" />
                    <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
                        <p style="margin:0; font-weight:600;">${card.title}</p>
                        <span style="font-size:10px; color:#aaa;">⭐ ${card.rating} &bull; ${card.genres}</span>
                    </div>
                    <span style="font-size:11px; background:rgba(229,9,20,0.8); color:#fff; border-radius:4px; padding:2px 6px;">${card.mediaType.toUpperCase()}</span>
                `;

                itemDiv.addEventListener("click", async () => {
                    // Track click CTR
                    await trackSearchClick(query);
                    
                    // Unify details card redirect
                    const isAnime = card.mediaType.toLowerCase() === 'anime';
                    const selectedItem = {
                        title: card.title,
                        image: card.image,
                        rating: card.rating,
                        description: "",
                        type: isAnime ? 'Anime' : card.mediaType,
                        mediaType: isAnime ? 'Anime' : card.mediaType,
                        year: "",
                        episodes: null,
                        id: isAnime ? null : card.id,
                        mal_id: isAnime ? card.id : null
                    };
                    localStorage.setItem("selectedItem", JSON.stringify(selectedItem));

                    // Add to watch history
                    let watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];
                    watchHistory = watchHistory.filter(h => !(h && h.title && h.title.toLowerCase().trim() === card.title.toLowerCase().trim()));
                    watchHistory.unshift(selectedItem);
                    localStorage.setItem("watchHistory", JSON.stringify(watchHistory.slice(0, 20)));
                    
                    // Save recent search
                    let recents = JSON.parse(localStorage.getItem("recentSearches") || "[]");
                    recents = recents.filter(q => q.toLowerCase().trim() !== query.toLowerCase().trim());
                    recents.unshift(query);
                    localStorage.setItem("recentSearches", JSON.stringify(recents.slice(0, 5)));

                    window.location.href = "details.html";
                });
                containerElement.appendChild(itemDiv);
            });
        } else {
            containerElement.classList.add("hidden");
        }
    } catch (e) {
        console.error("[Smart Search] Failed suggestions load:", e);
    }
}, 300);

// Auto initialize tags safely when the DOMContentLoaded or script evaluated
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSearchTags);
} else {
    loadSearchTags();
}
