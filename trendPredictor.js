import { db, doc, setDoc, getDoc, getUserData } from './db.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { TMDB_API_BASE, TMDB_API_KEY, TMDB_IMAGE_BASE } from './config.js';

const TMDB_API = TMDB_API_BASE;
const TMDB_KEY = TMDB_API_KEY;
const IMG_PATH = TMDB_IMAGE_BASE;

const SIBLING_GENRES = {
    'Action': ['Adventure', 'Sci-Fi', 'Fantasy'],
    'Adventure': ['Action', 'Fantasy', 'Comedy'],
    'Comedy': ['Slice of Life', 'Sports', 'Romance'],
    'Fantasy': ['Action', 'Adventure', 'Dark', 'Sci-Fi'],
    'Horror': ['Mystery', 'Dark', 'Thriller'],
    'Romance': ['Drama', 'Slice of Life', 'Comedy'],
    'Sci-Fi': ['Action', 'Fantasy', 'Adventure', 'Thriller'],
    'Dark': ['Horror', 'Mystery', 'Action'],
    'Slice of Life': ['Comedy', 'Romance', 'Drama'],
    'Sports': ['Comedy', 'Action', 'Slice of Life'],
    'Mystery': ['Horror', 'Thriller', 'Drama'],
    'Drama': ['Romance', 'Slice of Life', 'Mystery'],
    'Thriller': ['Mystery', 'Horror', 'Sci-Fi']
};

/**
 * Calculates user behavior forecasting.
 * Analyzes Favorites, Watched, My List, History, Search Activity, Clicks.
 */
export async function calculateUserForecast(user) {
    if (!user) return null;
    try {
        const [favorites, watched, myList, history, analyticsSnap] = await Promise.all([
            getUserData("favorites").then(r => r || []),
            getUserData("watched").then(r => r || []),
            getUserData("myList").then(r => r || []),
            getUserData("watchHistory").then(r => r || []),
            getDoc(doc(db, "analytics", "recommendations")).catch(() => null)
        ]);

        const searchTerms = JSON.parse(localStorage.getItem("recentSearches")) || [];

        // 1. Tally Genres and Content Types
        const genreTally = {};
        const typeTally = {};
        const allItems = [...favorites, ...watched, ...myList, ...history];

        allItems.forEach(item => {
            if (!item) return;
            const type = (item.mediaType || item.type || 'anime').toLowerCase();
            typeTally[type] = (typeTally[type] || 0) + 1;

            let genres = [];
            if (Array.isArray(item.genres)) {
                genres = item.genres.map(g => typeof g === 'object' ? g.name : g).filter(Boolean);
            } else if (typeof item.genres === 'string') {
                genres = item.genres.split(',').map(g => g.trim());
            } else if (item.genre) {
                genres = [item.genre];
            }

            genres.forEach(g => {
                genreTally[g] = (genreTally[g] || 0) + 1;
            });
        });

        // Resolve top genres
        const sortedGenres = Object.entries(genreTally).sort((a, b) => b[1] - a[1]);
        const topGenre = sortedGenres.length > 0 ? sortedGenres[0][0] : 'Action';
        const secondGenre = sortedGenres.length > 1 ? sortedGenres[1][0] : 'Fantasy';

        // Sibling genre selection (Next Likely Genre prediction)
        let predictedGenre = 'Action';
        const siblings = SIBLING_GENRES[topGenre] || SIBLING_GENRES['Action'];
        // Pick sibling not heavily watched, or default to first sibling
        predictedGenre = siblings.find(sib => !genreTally[sib]) || siblings[0];

        // Next likely content type
        const sortedTypes = Object.entries(typeTally).sort((a, b) => b[1] - a[1]);
        const predictedType = sortedTypes.length > 0 ? sortedTypes[0][0] : 'anime';

        // Title Category Prediction formatting
        const formattedType = predictedType === 'movie' ? 'Movie' : (predictedType === 'tv' ? 'TV Show' : 'Anime');
        const predictedCategory = `${predictedGenre} ${formattedType}`;

        const forecast = {
            userId: user.uid,
            predictedGenre,
            predictedType: formattedType,
            predictedCategory,
            forecastedAt: new Date().toISOString(),
            confidenceScore: allItems.length > 5 ? 88 : 65
        };

        // Save to Firestore
        await setDoc(doc(db, "userForecasts", user.uid), forecast, { merge: true });
        return forecast;
    } catch (e) {
        console.error("[Trend Engine] Failed user forecasting:", e);
        return null;
    }
}

/**
 * Calculates platform-wide trending predictions.
 * Formula: Trend Score = Views * (Favorites + Watch Growth + Recommendation Clicks)
 */
export async function calculatePlatformTrends() {
    try {
        // Fetch raw pool of candidates (trending weekly TMDB + top popular anime from Jikan)
        const [tmdbRes, jikanRes, recsAnalyticsSnap] = await Promise.all([
            fetch(`${TMDB_API}/trending/all/week?api_key=${TMDB_KEY}`).then(r => r.json()).catch(() => ({ results: [] })),
            fetch(`https://api.jikan.moe/v4/top/anime?filter=bypopularity`).then(r => r.json()).catch(() => ({ data: [] })),
            getDoc(doc(db, "analytics", "recommendations")).catch(() => null)
        ]);

        const recsAnalytics = recsAnalyticsSnap && recsAnalyticsSnap.exists() ? recsAnalyticsSnap.data() : {};
        const clickedCount = recsAnalytics.clickedCount || {};
        const recommendedCount = recsAnalytics.recommendedCount || {};

        const candidates = [];

        // Map TMDB candidates
        (tmdbRes.results || []).forEach(item => {
            const title = item.title || item.name;
            if (!title) return;
            const views = item.popularity || item.vote_count || 100;
            const favoritesSim = Math.floor(views * 0.05); // approximate baseline
            const watchGrowthSim = Math.floor(views * 0.08); // approximate baseline
            
            // Resolve clicks from Firestore recommendations impressions/clicks doc
            const cleanKey = title.replace(/[\.\#\$\/\[\]]/g, "_");
            const clicks = clickedCount[cleanKey] || 0;

            // Trend Score Formula
            const trendScore = views * (favoritesSim + watchGrowthSim + clicks);

            candidates.push({
                title,
                id: item.id,
                mediaType: item.media_type === 'tv' ? 'tv' : 'movie',
                poster_path: item.poster_path ? `${IMG_PATH}${item.poster_path}` : '',
                rating: item.vote_average || 7.0,
                views,
                trendScore,
                genres: item.genre_ids || []
            });
        });

        // Map Jikan candidates
        (jikanRes.data || []).forEach(item => {
            const title = item.title;
            if (!title) return;
            const views = item.members || 100;
            const favoritesSim = item.favorites || Math.floor(views * 0.04);
            const watchGrowthSim = Math.floor(views * 0.07);

            const cleanKey = title.replace(/[\.\#\$\/\[\]]/g, "_");
            const clicks = clickedCount[cleanKey] || 0;

            // Trend Score Formula
            const trendScore = views * (favoritesSim + watchGrowthSim + clicks);

            candidates.push({
                title,
                id: item.mal_id,
                mediaType: 'anime',
                poster_path: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '',
                rating: item.score || 7.5,
                views,
                trendScore,
                genres: (item.genres || []).map(g => g.name)
            });
        });

        // Rank by trend score descending
        candidates.sort((a, b) => b.trendScore - a.trendScore);

        // Deduplicate
        const seen = new Set();
        const deduped = candidates.filter(c => {
            const k = c.title.toLowerCase().trim();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });

        // Extract Top categories
        const predictedTrending = deduped.slice(0, 15);
        const risingThisWeek = deduped.slice(15, 30);

        const predictionDoc = {
            predictedTrending,
            risingThisWeek,
            calculatedAt: new Date().toISOString()
        };

        // Save to Firestore
        await setDoc(doc(db, "trendPredictions", "global"), predictionDoc, { merge: true });
        return predictionDoc;
    } catch (e) {
        console.error("[Trend Engine] Platform trend score calculation failed:", e);
        return null;
    }
}

/**
 * Exposes homepage binding logic for prediction segments.
 */
export async function loadPredictedTrends() {
    try {
        const ptSection = document.getElementById("predictedTrendingSection");
        const ptContainer = document.getElementById("predictedTrendingContainer");
        
        const rnSection = document.getElementById("recommendedNextSection");
        const rnContainer = document.getElementById("recommendedNextContainer");

        const rwSection = document.getElementById("risingThisWeekSection");
        const rwContainer = document.getElementById("risingThisWeekContainer");

        // Fetch predictions from Firestore
        let docSnap = await getDoc(doc(db, "trendPredictions", "global"));
        if (!docSnap.exists()) {
            // Compute on the fly if doc missing
            await calculatePlatformTrends();
            docSnap = await getDoc(doc(db, "trendPredictions", "global"));
        }

        if (docSnap.exists()) {
            const data = docSnap.data();
            const predictedTrending = data.predictedTrending || [];
            const risingThisWeek = data.risingThisWeek || [];

            const renderCollection = (list, container, section) => {
                if (!container || !section) return;
                container.innerHTML = "";
                if (list.length === 0) {
                    section.classList.add("hidden");
                    return;
                }
                
                list.forEach(item => {
                    const card = document.createElement("div");
                    card.className = "card";
                    card.innerHTML = `
                        <img src="${item.poster_path || 'https://via.placeholder.com/200x300'}" alt="${item.title}" loading="lazy" />
                        <div class="card-content">
                            <h3>${item.title}</h3>
                            <div class="card-meta">
                                <span class="rating">⭐ ${Number(item.rating).toFixed(1)}</span>
                                <span class="type-badge">${item.mediaType.toUpperCase()}</span>
                            </div>
                        </div>
                    `;
                    card.addEventListener("click", () => {
                        // Unify details card redirection
                        const isAnime = item.mediaType.toLowerCase() === 'anime';
                        const selectedItem = {
                            title: item.title,
                            image: item.poster_path,
                            rating: item.rating,
                            description: "",
                            type: isAnime ? 'Anime' : (item.mediaType === 'tv' ? 'TV' : 'Movie'),
                            mediaType: isAnime ? 'Anime' : (item.mediaType === 'tv' ? 'TV' : 'Movie'),
                            year: "",
                            episodes: null,
                            id: isAnime ? null : item.id,
                            mal_id: isAnime ? item.id : null
                        };
                        localStorage.setItem("selectedItem", JSON.stringify(selectedItem));
                        window.location.href = "details.html";
                    });
                    container.appendChild(card);
                });
                section.classList.remove("hidden");
            };

            // Render predicted trending and rising categories
            renderCollection(predictedTrending, ptContainer, ptSection);
            renderCollection(risingThisWeek, rwContainer, rwSection);

            // Populate Recommended Next (personalized using next likely genre)
            const auth = getAuth();
            if (auth.currentUser) {
                const forecastSnap = await getDoc(doc(db, "userForecasts", auth.currentUser.uid));
                if (forecastSnap.exists() && rnContainer && rnSection) {
                    const forecast = forecastSnap.data();
                    const nextGenre = forecast.predictedGenre || 'Action';
                    const nextType = forecast.predictedType || 'Anime';
                    
                    // Filter rising/trending pool that matches the predicted genre
                    const recommendedNext = predictedTrending.concat(risingThisWeek).filter(item => {
                        if (Array.isArray(item.genres)) {
                            // string matches
                            return item.genres.some(g => g.toString().toLowerCase().includes(nextGenre.toLowerCase()));
                        }
                        return false;
                    });

                    // Add fallback matches if genre list empty
                    const finalRecs = recommendedNext.length > 2 
                        ? recommendedNext 
                        : predictedTrending.slice(5, 12);
                    
                    renderCollection(finalRecs, rnContainer, rnSection);
                }
            } else {
                if (rnSection) rnSection.classList.add("hidden");
            }
        }
    } catch (e) {
        console.error("[Trend Engine] Failed rendering Predicted Trends:", e);
    }
}

// Auto-run on load after authentication is initialized
window.addEventListener('load', () => {
    setTimeout(async () => {
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            
            // Run prediction computations
            if (user) {
                await calculateUserForecast(user);
            }
            await calculatePlatformTrends();
            await loadPredictedTrends();
        } catch (err) {
            console.warn("[Trend Engine] Auto-run failed:", err);
        }
    }, 1500); // Allow other core scripts to load first
});
