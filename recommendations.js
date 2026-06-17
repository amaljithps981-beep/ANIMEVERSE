/**
 * recommendations.js
 * Advanced Content-Based Recommendation Engine for AnimeVerse V2
 * -------------------------------------------------------------
 * Features:
 * 1. Strict duplicate exclusion (filters out Watched, Favorites, and Continue Watching).
 * 2. Genre-based similarity matching using userPreferences and TMDB movie/TV metadata.
 * 3. Recommendation sections:
 *    - Recommended For You (personalized via top genres and watch history recommendations)
 *    - Because You Watched (similar to last watched title)
 *    - Similar To Your Favorites (similar to last favorited title)
 *    - Trending In Your Genres (trending items matching top genres)
 * 4. Cache generated recommendation lists inside the Firestore 'recommendations' collection
 *    to speed up homepage rendering, with auto-regeneration when seeds change.
 */

import { getPreferences, fetchDbToStorage, fetchCachedRecommendations, saveRecommendations, analyzeUserPreferences, db, logRecommendationMetric, auth } from './db.js';
import { doc, setDoc, increment, collection, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

async function enrichDeepRecommendation(item) {
    const isAnime = item.mediaType === 'anime' || item.mediaType === 'Anime';
    const cid = item.contentId;
    
    // Try to get cached item data from localStorage to avoid redundant API hits
    try {
        if (isAnime) {
            const cacheKey = `anime_details_${cid}`;
            let cached = localStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                item.poster_path = parsed.poster_path;
                item.vote_average = parsed.vote_average;
                item.overview = parsed.overview;
                item.mal_id = cid;
                item.media_type = 'anime';
                return item;
            }
            // Fetch from Jikan API
            const res = await cachedFetch(`https://api.jikan.moe/v4/anime/${cid}`);
            if (res && res.data) {
                const anime = res.data;
                const poster = anime.images && anime.images.jpg ? (anime.images.jpg.large_image_url || anime.images.jpg.image_url) : "";
                item.poster_path = poster;
                item.vote_average = anime.score || 8.0;
                item.overview = anime.synopsis || "";
                item.mal_id = cid;
                item.media_type = 'anime';
                localStorage.setItem(cacheKey, JSON.stringify({
                    poster_path: poster,
                    vote_average: anime.score || 8.0,
                    overview: anime.synopsis || ""
                }));
            }
        } else {
            const cacheKey = `tmdb_details_${item.mediaType}_${cid}`;
            let cached = localStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                item.poster_path = parsed.poster_path;
                item.vote_average = parsed.vote_average;
                item.overview = parsed.overview;
                item.id = cid;
                item.media_type = item.mediaType;
                return item;
            }
            // Fetch from TMDB
            const type = item.mediaType === 'tv' ? 'tv' : 'movie';
            const res = await cachedFetch(`${TMDB}/${type}/${cid}?api_key=${KEY}`);
            if (res) {
                const poster = res.poster_path ? IMG + res.poster_path : "";
                item.poster_path = poster;
                item.vote_average = res.vote_average || 7.0;
                item.overview = res.overview || "";
                item.id = cid;
                item.media_type = item.mediaType;
                localStorage.setItem(cacheKey, JSON.stringify({
                    poster_path: poster,
                    vote_average: res.vote_average || 7.0,
                    overview: res.overview || ""
                }));
            }
        }
    } catch (e) {
        console.warn("Failed to enrich deep recommendation:", item.title, e);
    }
    
    // Fallback if APIs fail
    if (!item.poster_path) {
        item.poster_path = `https://via.placeholder.com/200x300/1a1a1a/e50914?text=${encodeURIComponent(item.title)}`;
    }
    if (isAnime) {
        item.mal_id = cid;
        item.media_type = 'anime';
    } else {
        item.id = cid;
        item.media_type = item.mediaType;
    }
    return item;
}

function sanitizeTitle(title) {
    return (title || '').replace(/[\.\#\$\/\[\]]/g, "_");
}

async function trackRecommendationImpression(titles) {
    if (titles.length === 0) return;
    try {
        const docRef = doc(db, "analytics", "recommendations");
        const updates = {
            impressions: increment(titles.length)
        };
        titles.forEach(title => {
            const key = `recommendedCount.${sanitizeTitle(title)}`;
            updates[key] = increment(1);
        });
        await setDoc(docRef, updates, { merge: true });
    } catch (e) {
        console.warn("Error tracking recommendation impression:", e);
    }
}

async function trackRecommendationClick(item) {
    if (!item) return;
    const title = item.title || item.name;
    const cid = item.id || item.mal_id;
    try {
        // Log click metric
        await logRecommendationMetric('click');

        const docRef = doc(db, "analytics", "recommendations");
        const updates = {
            clicks: increment(1)
        };
        if (title) {
            const key = `clickedCount.${sanitizeTitle(title)}`;
            updates[key] = increment(1);
        }
        await setDoc(docRef, updates, { merge: true });

        // Update User Feedback loop for Hybrid Engine
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
        const auth = getAuth();
        const user = auth.currentUser;
        if (user && cid) {
            const fbRef = doc(db, "recommendationFeedback", user.uid);
            const fbUpdates = {};
            fbUpdates[`clicks.${cid}`] = increment(1);
            await setDoc(fbRef, fbUpdates, { merge: true });
        }
    } catch (e) {
        console.warn("Error tracking recommendation click:", e);
    }
}

const TMDB  = "https://api.themoviedb.org/3";
const KEY   = "c2772546356cffa3fb0504e91da76541";
const IMG   = "https://image.tmdb.org/t/p/w500";

// ── In-Memory API Cache to Avoid Duplicate Hits ─────────────
const _cache = new Map();
async function cachedFetch(url) {
    if (_cache.has(url)) return _cache.get(url);
    try {
        const res  = await fetch(url);
        const data = await res.json();
        _cache.set(url, data);
        return data;
    } catch (e) {
        console.error("cachedFetch error for URL:", url, e);
        return null;
    }
}

// ── TMDB Genre Mappings ─────────────────────────────────────
const GENRE_ID_TO_NAME = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    18: "Drama", 14: "Fantasy", 27: "Horror", 9648: "Mystery", 10749: "Romance",
    878: "Sci-Fi", 53: "Thriller", 10759: "Action & Adventure", 10765: "Sci-Fi & Fantasy",
    10766: "Romance", 10751: "Family", 36: "History", 10402: "Music",
    10752: "War", 37: "Western", 99: "Documentary"
};

const TMDB_GENRES = {
    Action: 28, Adventure: 12, Animation: 16, Comedy: 35,
    Crime: 80, Drama: 18, Fantasy: 14, Horror: 27,
    Mystery: 9648, Romance: 10749, "Sci-Fi": 878, Thriller: 53,
    "Science Fiction": 878,
};

const TV_GENRES = {
    Action: 10759, Animation: 16, Comedy: 35, Drama: 18,
    Fantasy: 10765, Horror: 9648, Mystery: 9648, Romance: 10766,
    "Sci-Fi": 10765, "Science Fiction": 10765,
};

// ── Excluded Titles (Watched, Favorites, Continue Watching) ─
export async function getExcludedTitles() {
    const [favorites, watched, myList, hiddenSnap] = await Promise.all([
        fetchDbToStorage("favorites").then(r => r || []),
        fetchDbToStorage("watched").then(r => r || []),
        fetchDbToStorage("myList").then(r => r || []),
        getDocs(collection(db, "hiddenContent")).catch(() => null)
    ]);
    
    const excludedSet = new Set();
    const allItems = [...favorites, ...watched, ...myList];
    
    allItems.forEach(item => {
        if (item) {
            const title = item.title || item.name;
            if (title) {
                excludedSet.add(title.toLowerCase().trim());
            }
        }
    });
    
    if (hiddenSnap) {
        hiddenSnap.forEach(doc => {
            const data = doc.data();
            if (data.title) {
                excludedSet.add(data.title.toLowerCase().trim());
            }
        });
    }
    
    return excludedSet;
}

// ── AI Phase 1: Smart Recommendation Scoring ────────────────────────────────
export function calculateRecommendationScore(item, userPrefs) {
    let score = 0;
    
    // Genre Match (+50)
    let itemGenres = [];
    if (Array.isArray(item.genres)) {
        itemGenres = item.genres.map(g => typeof g === 'object' ? (g.name || '') : g).filter(Boolean);
    } else if (item.genre_ids) {
        itemGenres = (item.genre_ids || []).map(id => GENRE_ID_TO_NAME[id]).filter(Boolean);
    }
    
    let hasGenreMatch = false;
    const topGenres = userPrefs.topGenres || [];
    itemGenres.forEach(genre => {
        if (topGenres.includes(genre)) {
            hasGenreMatch = true;
        }
    });
    if (hasGenreMatch) {
        score += 50;
    }

    // Media Type Match (+20)
    const itemType = (item.media_type || item.type || 'anime').toLowerCase();
    const prefType = (userPrefs.favoriteType || 'anime').toLowerCase();
    if (itemType === prefType) {
        score += 20;
    }

    // High Rating (+15)
    const rating = item.vote_average || item.score || 0;
    if (rating >= 8.0) {
        score += 15;
    }

    // Trending (+10) (Inferred if popularity is very high or if explicitly passed)
    const popularity = item.popularity || item.members || 0;
    if (popularity > 1000 || item.isTrending) {
        score += 10;
    }

    // Popularity (+5) (If it has a baseline popularity)
    if (popularity > 100) {
        score += 5;
    }

    return score;
}

// ── Details Redirection ─────────────────────────────────────
function goToDetails(item, fromRec = false) {
    const isAnime = item.media_type === 'Anime' || item.type === 'Anime' || !!item.mal_id;
    const image = item.poster_path && item.poster_path.startsWith("http")
        ? item.poster_path
        : (item.poster_path ? IMG + item.poster_path : '');
    
    const selectedItem = {
        title:       item.title || item.name,
        image:       image,
        rating:      item.vote_average || null,
        description: item.overview || '',
        type:        isAnime ? 'Anime' : (item.media_type || item.type || ''),
        mediaType:   isAnime ? 'Anime' : (item.media_type || item.type || ''),
        year:        (item.release_date || item.first_air_date || '').slice(0, 4),
        episodes:    item.number_of_episodes || item.episodes || null,
        id:          isAnime ? null : (item.id || null),
        mal_id:      item.mal_id || null,
        fromRecommendation: fromRec
    };
    localStorage.setItem("selectedItem", JSON.stringify(selectedItem));
    window.location.href = "details.html";
}

// ── Cards Renderer ──────────────────────────────────────────
function renderCards(items, container, excludedSet, limit = 20) {
    if (!container) return;
    container.innerHTML = "";
    let count = 0;
    const titlesTracked = [];
    for (const item of items) {
        if (count >= limit) break;
        const title = item.title || item.name || '';
        if (!title || !item.poster_path) continue;
        if (excludedSet.has(title.toLowerCase().trim())) continue;

        titlesTracked.push(title);

        const image = item.poster_path.startsWith("http")
            ? item.poster_path
            : IMG + item.poster_path;

        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
            <img src="${image}" alt="${title}" loading="lazy" />
            <div class="card-content">
                <h3>${title}</h3>
                <div class="card-meta">
                    <span class="rating">⭐ ${item.vote_average ? (typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : item.vote_average) : 'N/A'}</span>
                    ${item.media_type ? `<span class="type-badge">${item.media_type.toUpperCase()}</span>` : ''}
                </div>
            </div>`;
        card.addEventListener("click", () => {
            trackRecommendationClick(item);
            goToDetails(item, true);
        });
        container.appendChild(card);
        count++;
    }
    if (titlesTracked.length > 0) {
        trackRecommendationImpression(titlesTracked);
        logRecommendationMetric('impression', titlesTracked.length);
    }
    if (container.updateCarousel) {
        container.updateCarousel();
    }
}

// ── TMDB recommendations by title ──────────────────────────
export async function fetchSimilarFromTitle(seedTitle) {
    if (!seedTitle) return { seed: '', items: [] };
    try {
        const search = await cachedFetch(`${TMDB}/search/multi?api_key=${KEY}&query=${encodeURIComponent(seedTitle)}`);
        if (!search || !search.results || search.results.length === 0) {
            return { seed: seedTitle, items: [] };
        }
        const seed = search.results.find(r => r.poster_path);
        if (!seed) return { seed: seedTitle, items: [] };

        const type = seed.media_type === 'tv' || seed.first_air_date ? 'tv' : 'movie';
        const recs = await cachedFetch(`${TMDB}/${type}/${seed.id}/recommendations?api_key=${KEY}`);
        if (!recs || !recs.results) {
            return { seed: seedTitle, items: [] };
        }
        
        const items = recs.results.map(r => ({
            id: r.id,
            title: r.title || r.name,
            poster_path: r.poster_path,
            vote_average: r.vote_average,
            media_type: type,
            overview: r.overview,
            release_date: r.release_date || r.first_air_date || '',
            genre_ids: r.genre_ids || []
        }));
        return { seed: seedTitle, items };
    } catch (e) {
        console.warn(`Error fetching similar for ${seedTitle}:`, e);
        return { seed: seedTitle, items: [] };
    }
}

// ── Main Recommendation Engine Builder ──────────────────────
// ── Jikan recommendations by Anime ──────────────────────────
async function fetchAnimeRecommendations(history, favorites, watched, myList) {
    const allItems = [...history, ...favorites, ...watched, ...myList];
    const seedAnime = allItems.find(item => {
        if (!item) return false;
        const typeLower = (item.mediaType || item.type || '').toString().toLowerCase();
        return item.mal_id || typeLower === 'anime';
    });

    if (seedAnime && seedAnime.mal_id) {
        console.log(`Found seed anime for recommendations: ${seedAnime.title} (mal_id: ${seedAnime.mal_id})`);
        try {
            const data = await cachedFetch(`https://api.jikan.moe/v4/anime/${seedAnime.mal_id}/recommendations`);
            if (data && Array.isArray(data.data)) {
                const items = data.data.map(rec => {
                    const anime = rec.entry;
                    return {
                        title: anime.title,
                        poster_path: anime.images && anime.images.jpg ? (anime.images.jpg.large_image_url || anime.images.jpg.image_url) : "",
                        vote_average: 8.0, // fallback average rating
                        media_type: 'Anime',
                        type: 'Anime',
                        mal_id: anime.mal_id,
                        id: null,
                        overview: "",
                        release_date: ""
                    };
                });
                return { seed: seedAnime.title, items };
            }
        } catch (e) {
            console.error("Error fetching Jikan recommendations for seed anime:", e);
        }
    }

    // Fallback: Fetch top popular anime
    console.log("No seed anime found or Jikan error. Using popular anime as fallback for Because You Watch Anime.");
    try {
        const data = await cachedFetch(`https://api.jikan.moe/v4/top/anime?filter=bypopularity`);
        if (data && Array.isArray(data.data)) {
            const items = data.data.map(item => ({
                title:       item.title,
                poster_path: item.images && item.images.jpg ? item.images.jpg.large_image_url : "",
                vote_average: item.score || 8.0,
                overview:    item.synopsis || "",
                type:        'Anime',
                media_type:  'Anime',
                episodes:    item.episodes || null,
                mal_id:      item.mal_id,
                id:          null,
                release_date: item.aired && item.aired.from ? item.aired.from : '',
                genres:      item.genres || []
            }));
            return { seed: "Popular", items };
        }
    } catch (e) {
        console.error("Error fetching Jikan top anime for fallback:", e);
    }

    return { seed: '', items: [] };
}

// ── Main Recommendation Engine Builder ──────────────────────
export async function buildRecommendations() {
    // 1. Get user data in parallel
    const [history, favorites, watched, myList, userPrefs] = await Promise.all([
        fetchDbToStorage("watchHistory").then(r => r || []),
        fetchDbToStorage("favorites").then(r => r || []),
        fetchDbToStorage("watched").then(r => r || []),
        fetchDbToStorage("myList").then(r => r || []),
        analyzeUserPreferences()
    ]);
    const excludedSet = await getExcludedTitles();

    // 2. Fetch Cached recommendations
    const cached = await fetchCachedRecommendations();

    const seedFav = favorites.length > 0 ? (favorites[0].title || favorites[0].name) : '';
    
    // Find if we have Anime in history/favorites/etc.
    const allItems = [...history, ...favorites, ...watched, ...myList];
    const seedAnimeItem = allItems.find(item => {
        if (!item) return false;
        const typeLower = (item.mediaType || item.type || '').toString().toLowerCase();
        return item.mal_id || typeLower === 'anime';
    });
    const currentSeedAnime = seedAnimeItem ? seedAnimeItem.title : 'Popular';
    
    // Use preferences from analyzeUserPreferences
    const topGenres = userPrefs && userPrefs.topGenres ? userPrefs.topGenres : [];
    const preferredType = userPrefs && userPrefs.favoriteType ? userPrefs.favoriteType : 'anime';

    // 3. Cache freshness check
    let isCacheValid = false;
    if (cached && cached.generatedAt) {
        const cacheTime = new Date(cached.generatedAt).getTime();
        const now = new Date().getTime();
        const diffMin = (now - cacheTime) / (1000 * 60);

        const cacheSeedAnime = cached.becauseYouWatchAnime ? cached.becauseYouWatchAnime.seed : '';
        const cacheSeedFav = cached.similarToFavorites ? cached.similarToFavorites.seed : '';
        const cacheGenre = cached.trendingInGenres ? cached.trendingInGenres.genre : '';
        const currentTopGenre = topGenres.length > 0 ? topGenres[0] : '';

        // If time < 15 mins and seeds match, cache is valid
        if (diffMin < 15 && cacheSeedAnime === currentSeedAnime && cacheSeedFav === seedFav && cacheGenre === currentTopGenre) {
            isCacheValid = true;
        }
    }

    let recommendationsData = null;

    if (isCacheValid) {
        console.log("Using cached recommendations from Firestore.");
        recommendationsData = cached;
    } else {
        console.log("Regenerating recommendations...");
        recommendationsData = {
            recommendedForYou: [],
            becauseYouWatchAnime: { seed: currentSeedAnime, items: [] },
            similarToFavorites: { seed: seedFav, items: [] },
            trendingInGenres: { genre: topGenres.length > 0 ? topGenres[0] : '', items: [] }
        };

        // Prepare Section fetches in parallel
        let animePromise = fetchAnimeRecommendations(history, favorites, watched, myList);

        let favPromise = Promise.resolve({ items: [] });
        if (seedFav) {
            favPromise = fetchSimilarFromTitle(seedFav);
        }

        const mainGenre = topGenres.length > 0 ? topGenres[0] : '';
        let genreMoviesPromise = Promise.resolve(null);
        let genreTvsPromise = Promise.resolve(null);
        if (mainGenre) {
            const gid = TMDB_GENRES[mainGenre];
            if (gid) {
                genreMoviesPromise = cachedFetch(`${TMDB}/discover/movie?api_key=${KEY}&with_genres=${gid}&sort_by=vote_count.desc`);
                genreTvsPromise = cachedFetch(`${TMDB}/discover/tv?api_key=${KEY}&with_genres=${TV_GENRES[mainGenre] || gid}&sort_by=vote_count.desc`);
            }
        } else {
            // Cold-start weekly trending overall
            genreMoviesPromise = cachedFetch(`${TMDB}/trending/all/week?api_key=${KEY}`);
        }

        // RECOMMENDED FOR YOU (Similarity-driven pool fetches)
        const poolPromises = [];

        // Add matching genre content
        if (topGenres.length > 0) {
            topGenres.slice(0, 2).forEach(genre => {
                const gid = TMDB_GENRES[genre];
                if (gid) {
                    poolPromises.push(
                        cachedFetch(`${TMDB}/discover/movie?api_key=${KEY}&with_genres=${gid}&sort_by=popularity.desc`)
                            .then(data => (data && data.results ? data.results.map(r => ({ ...r, media_type: 'movie' })) : []))
                    );
                    poolPromises.push(
                        cachedFetch(`${TMDB}/discover/tv?api_key=${KEY}&with_genres=${TV_GENRES[genre] || gid}&sort_by=popularity.desc`)
                            .then(data => (data && data.results ? data.results.map(r => ({ ...r, media_type: 'tv' })) : []))
                    );
                }
            });
        } else {
            poolPromises.push(
                cachedFetch(`${TMDB}/trending/all/week?api_key=${KEY}`)
                    .then(data => (data && data.results ? data.results : []))
            );
        }

        // Add similar items from history to pool
        history.slice(0, 3).forEach(hItem => {
            const title = hItem.title || hItem.name;
            if (title) {
                poolPromises.push(
                    fetchSimilarFromTitle(title).then(res => res.items || [])
                );
            }
        });

        // Run all API calls concurrently
        const [animeRes, favRes, genreMovies, genreTvs, poolLists] = await Promise.all([
            animePromise,
            favPromise,
            genreMoviesPromise,
            genreTvsPromise,
            Promise.all(poolPromises)
        ]);

        recommendationsData.becauseYouWatchAnime.items = animeRes.items || [];
        recommendationsData.similarToFavorites.items = favRes.items || [];

        if (mainGenre) {
            const movieItems = (genreMovies ? genreMovies.results || [] : []).map(r => ({ ...r, media_type: 'movie' }));
            const tvItems = (genreTvs ? genreTvs.results || [] : []).map(r => ({ ...r, media_type: 'tv' }));
            recommendationsData.trendingInGenres.items = [...movieItems, ...tvItems].sort((a,b) => (b.vote_average || 0) - (a.vote_average || 0));
        } else {
            recommendationsData.trendingInGenres.items = genreMovies ? genreMovies.results || [] : [];
        }

        let candidatePool = [];
        poolLists.forEach(list => {
            candidatePool.push(...list);
        });

        // Mix Jikan Anime suggestions into candidate pool
        if (animeRes && animeRes.items) {
            candidatePool.push(...animeRes.items);
        }

        // Deduplicate pool by ID / MAL ID
        const seenIds = new Set();
        const seenTitles = new Set();
        const dedupedPool = candidatePool.filter(item => {
            if (!item) return false;
            const title = (item.title || item.name || '').toLowerCase().trim();
            if (!title) return false;
            if (seenTitles.has(title)) return false;
            
            const key = item.mal_id ? `anime_${item.mal_id}` : `tmdb_${item.id}`;
            if (seenIds.has(key)) return false;
            
            seenIds.add(key);
            seenTitles.add(title);
            return true;
        });

        // Score all candidates
        const scoredCandidates = dedupedPool.map(item => {
            const score = calculateRecommendationScore(item, userPrefs || { topGenres, favoriteType: preferredType });
            return {
                item,
                score: score
            };
        });

        // Sort by similarity score descending
        scoredCandidates.sort((a, b) => b.score - a.score);

        // Map back to item list
        recommendationsData.recommendedForYou = scoredCandidates.map(c => c.item);

        // Save generated recommendations to Firestore recommendations collection
        await saveRecommendations(recommendationsData);
    }

    // 4. Render recommendations sections in UI
    // Excluded Set is always applied on-the-fly to filter out items watched in this session
    
    // A. Recommended For You
    const recContainer = document.getElementById("recommendedContainer");
    const recSection = document.getElementById("recommendedSection");
    if (recContainer && recSection) {
        if (recommendationsData.recommendedForYou.length > 0) {
            renderCards(recommendationsData.recommendedForYou, recContainer, excludedSet);
            recSection.classList.remove("hidden");
            const lbl = document.getElementById("recommendedGenreLabel");
            if (lbl && topGenres.length > 0) {
                lbl.innerText = `Because you love ${topGenres.slice(0, 2).join(" & ")}`;
            }
        } else {
            recSection.classList.add("hidden");
        }
    }

    // B. Because You Watch Anime
    const becauseContainer = document.getElementById("becauseContainer");
    const becauseSection = document.getElementById("becauseSection");
    const becauseLabel = document.getElementById("becauseLabel");
    if (becauseContainer && becauseSection) {
        const seed = recommendationsData.becauseYouWatchAnime.seed;
        const items = recommendationsData.becauseYouWatchAnime.items;
        if (items && items.length > 0) {
            renderCards(items, becauseContainer, excludedSet);
            becauseSection.classList.remove("hidden");
            if (becauseLabel) {
                becauseLabel.innerText = seed === "Popular" ? "Because You Watch Anime" : `Because You Watch Anime: "${seed}"`;
            }
        } else {
            becauseSection.classList.add("hidden");
        }
    }

    // C. Similar To Your Favorites
    const favContainer = document.getElementById("similarFavoritesContainer");
    const favSection = document.getElementById("similarFavoritesSection");
    const favLabel = document.getElementById("similarFavoritesLabel");
    if (favContainer && favSection) {
        const seed = recommendationsData.similarToFavorites.seed;
        const items = recommendationsData.similarToFavorites.items;
        if (seed && items.length > 0) {
            renderCards(items, favContainer, excludedSet);
            favSection.classList.remove("hidden");
            if (favLabel) favLabel.innerText = `Similar To Your Favorite: "${seed}"`;
        } else {
            favSection.classList.add("hidden");
        }
    }

    // D. Trending In Your Genres / Because You Like [Genre]
    const trendContainer = document.getElementById("trendingGenreContainer");
    const trendSection = document.getElementById("trendingGenreSection");
    const trendLabel = document.getElementById("trendingGenreLabel");
    if (trendContainer && trendSection) {
        const genre = recommendationsData.trendingInGenres.genre;
        const items = recommendationsData.trendingInGenres.items;
        if (items.length > 0) {
            renderCards(items, trendContainer, excludedSet);
            trendSection.classList.remove("hidden");
            if (trendLabel) {
                trendLabel.innerText = genre ? `Because You Like ${genre}` : "Because You Like Action";
            }
        } else {
            trendSection.classList.add("hidden");
        }
    }

    // ── PHASE 5: HYBRID RECOMMENDATION ENGINE UI BINDING ──
    const user = auth.currentUser;
    
    // 1. Fetch User Feedback for Real-Time Adjustment
    let userFeedback = {};
    if (user) {
        try {
            const feedbackSnap = await getDoc(doc(db, "recommendationFeedback", user.uid));
            if (feedbackSnap.exists()) {
                userFeedback = feedbackSnap.data().clicks || {};
            }
        } catch (e) {
            console.warn("Could not load user feedback", e);
        }
    }

    // 2. Fetch Hybrid Recommendations (or Cold Start)
    let hybridData = null;
    try {
        const fetchUid = user ? user.uid : "COLD_START";
        let docSnap = await getDoc(doc(db, "hybridRecommendations", fetchUid));
        
        // Fallback to COLD_START if user has no hybrid data yet
        if (!docSnap.exists() && user) {
            docSnap = await getDoc(doc(db, "hybridRecommendations", "COLD_START"));
        }

        if (docSnap.exists()) {
            hybridData = docSnap.data().categories;
        }
    } catch (e) {
        console.warn("Failed to load hybrid recommendations", e);
    }

    // Helper to map hybrid payload to AnimeVerse UI cards and apply real-time feedback
    const processHybridCategory = (items, prefixLabel) => {
        if (!items) return [];
        return items.map(r => {
            // Apply real-time feedback reinforcement (+0.05 per click)
            const clicks = userFeedback[r.contentId] || 0;
            const finalScore = r.hybridScore + (clicks * 0.05);
            const placeholderImg = `https://via.placeholder.com/200x300/1a1a1a/e50914?text=${encodeURIComponent(r.title)}`;
            return {
                id: r.contentId, 
                mal_id: r.contentId, 
                title: r.title, 
                name: r.title, 
                mediaType: "anime",
                media_type: "anime",
                poster_path: placeholderImg,
                images: { jpg: { image_url: placeholderImg } }
            };
        });
    };

    // ── FALLBACK RECOMMENDATION SYSTEM (DL -> Hybrid -> CB) ──
    const deepSection = document.getElementById("deepRecommendationsSection");
    const deepContainer = document.getElementById("deepRecommendationsContainer");
    const bestMatchSection = document.getElementById("hybridBestMatchSection");
    const bestMatchContainer = document.getElementById("hybridBestMatchContainer");
    
    let deepSuccess = false;
    let hybridSuccess = false;
    let contentSuccess = false;
    
    // 1. Fetch Deep Learning Recommendations
    try {
        const fetchUid = user ? user.uid : "COLD_START";
        const deepSnap = await getDoc(doc(db, "deepRecommendations", fetchUid));
        let deepRecsData = null;
        if (deepSnap.exists()) {
            deepRecsData = deepSnap.data().recommendations;
        } else if (!user) {
            // Cold start fallback
            const coldSnap = await getDoc(doc(db, "deepRecommendations", "COLD_START"));
            if (coldSnap.exists()) {
                deepRecsData = coldSnap.data().recommendations;
            }
        }
        
        if (deepRecsData && deepRecsData.length > 0) {
            const enrichedRecs = await Promise.all(deepRecsData.map(item => enrichDeepRecommendation(item)));
            renderCards(enrichedRecs, deepContainer, excludedSet);
            if (deepSection) deepSection.classList.remove("hidden");
            deepSuccess = true;
            console.log("Deep Learning recommendations loaded successfully.");
        }
    } catch (e) {
        console.warn("Failed to load deep learning recommendations:", e);
    }
    
    // Apply Fallback Strategy
    if (deepSuccess) {
        // Deep learning recommendations are displayed! Hide Hybrid and Content-Based primary carousels.
        if (bestMatchSection) bestMatchSection.classList.add("hidden");
        if (recSection) recSection.classList.add("hidden");
    } else {
        // Fallback to Hybrid
        if (deepSection) deepSection.classList.add("hidden");
        
        if (hybridData && hybridData.bestMatch && hybridData.bestMatch.length > 0) {
            const items = processHybridCategory(hybridData.bestMatch, "Best");
            if (items.length > 0) {
                renderCards(items, bestMatchContainer, excludedSet);
                if (bestMatchSection) bestMatchSection.classList.remove("hidden");
                hybridSuccess = true;
                console.log("Hybrid recommendations loaded as fallback.");
            }
        }
        
        if (hybridSuccess) {
            if (recSection) recSection.classList.add("hidden");
        } else {
            // Fallback to Content-Based
            if (bestMatchSection) bestMatchSection.classList.add("hidden");
            
            if (recommendationsData && recommendationsData.recommendedForYou && recommendationsData.recommendedForYou.length > 0) {
                renderCards(recommendationsData.recommendedForYou, recContainer, excludedSet);
                if (recSection) recSection.classList.remove("hidden");
                contentSuccess = true;
                console.log("Content-Based recommendations loaded as fallback.");
            }
            
            if (!contentSuccess) {
                // Fallback to Popular
                if (recSection) recSection.classList.add("hidden");
                console.log("No personalized recommendations available. Fallback to Popular.");
            }
        }
    }

    if (hybridData) {
        // 2. Anime You Will Love
        const youLoveContainer = document.getElementById("hybridAnimeYouLoveContainer");
        const youLoveSection = document.getElementById("hybridAnimeYouLoveSection");
        if (youLoveContainer && youLoveSection && hybridData.animeYouWillLove) {
            const items = processHybridCategory(hybridData.animeYouWillLove, "Love");
            if (items.length > 0) {
                renderCards(items, youLoveContainer, excludedSet);
                youLoveSection.classList.remove("hidden");
            }
        }

        // 3. Users Like You Also Enjoy
        const likeYouContainer = document.getElementById("hybridUsersLikeYouContainer");
        const likeYouSection = document.getElementById("hybridUsersLikeYouSection");
        if (likeYouContainer && likeYouSection && hybridData.usersLikeYou) {
            const items = processHybridCategory(hybridData.usersLikeYou, "Collab");
            if (items.length > 0) {
                renderCards(items, likeYouContainer, excludedSet);
                likeYouSection.classList.remove("hidden");
            }
        }

        // 4. Hidden Gems
        const gemsContainer = document.getElementById("hybridHiddenGemsContainer");
        const gemsSection = document.getElementById("hybridHiddenGemsSection");
        if (gemsContainer && gemsSection && hybridData.hiddenGems) {
            const items = processHybridCategory(hybridData.hiddenGems, "Gem");
            if (items.length > 0) {
                renderCards(items, gemsContainer, excludedSet);
                gemsSection.classList.remove("hidden");
            }
        }

        // 5. Trending For You
        const trendingContainer = document.getElementById("hybridTrendingContainer");
        const trendingSection = document.getElementById("hybridTrendingSection");
        if (trendingContainer && trendingSection && hybridData.trendingForYou) {
            const items = processHybridCategory(hybridData.trendingForYou, "Trend");
            if (items.length > 0) {
                renderCards(items, trendingContainer, excludedSet);
                trendingSection.classList.remove("hidden");
            }
        }
    }
}

// ── Run on Import/Load (Deferred until after homepage renders) ──
window.addEventListener('load', () => {
    setTimeout(async () => {
        try {
            await buildRecommendations();
        } catch (err) {
            console.error("Recommendations system execution failed:", err);
        }
    }, 100);
});
