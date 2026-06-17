import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG, DB_TIMEOUT_MS, TMDB_GENRES } from './config.js';

const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
export const db = getFirestore(app);

let currentUser = null;
let isAuthInitialized = false;
let authResolve;
export const authReady = new Promise((resolve) => {
    authResolve = resolve;
});

// In-Memory Caches to Optimize Database Reads/Writes
const userListCache = {}; 
const userPrefsCache = {}; 
const recsCache = {}; 

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    isAuthInitialized = true;
    
    // Clear caches on logout
    if (!user) {
        for (const k in userListCache) delete userListCache[k];
        for (const k in userPrefsCache) delete userPrefsCache[k];
        for (const k in recsCache) delete recsCache[k];
    }
    
    authResolve(user);
    // NOTE: Do NOT redirect here. db.js is a data layer only.
    // Auth redirects are handled by firebase.js (for index.html)
    // and guard.js (for protected list pages).
});

export async function getActiveUser() {
    if (isAuthInitialized) return currentUser;
    return await authReady;
}


export function deduplicateList(dataArray) {
    if (!dataArray || !Array.isArray(dataArray)) {
        return [];
    }
    const uniqueMap = new Map();
    dataArray.forEach(item => {
        if (!item) return;
        const title = item.title || item.name;
        if (!title) return;
        const key = title.toLowerCase().trim();
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, item);
        }
    });
    return Array.from(uniqueMap.values()).map(item => {
        if (!item.addedAt) {
            item.addedAt = new Date().toISOString();
        }
        return item;
    });
}

// Sequential queue helper to serialize read/write operations per key
const syncQueues = {};
async function enqueueTask(key, task) {
    if (!syncQueues[key]) {
        syncQueues[key] = Promise.resolve();
    }
    const nextPromise = syncQueues[key].then(task);
    syncQueues[key] = nextPromise.catch((err) => {
        console.error(`Queue error for key ${key}:`, err);
    });
    return nextPromise;
}

export async function awaitWithTimeout(promise, timeoutMs = DB_TIMEOUT_MS) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
}

export async function saveUserData(collectionName, dataArray) {
    const user = await getActiveUser();
    if (!user) return;

    if (!userListCache[user.uid]) userListCache[user.uid] = {};
    userListCache[user.uid][collectionName] = dataArray;

    let primaryOk = false;
    try {
        const userDocRef = doc(db, 'users', user.uid);
        await awaitWithTimeout(setDoc(userDocRef, { [collectionName]: dataArray }, { merge: true }));
        primaryOk = true;
    } catch (err) {
        console.error(`Save ${collectionName} failed:`, err);
    }

    if (!primaryOk) {
        try {
            const colDocRef = doc(db, collectionName, user.uid);
            await awaitWithTimeout(setDoc(colDocRef, { items: dataArray }, { merge: true }));
        } catch (err) {
            console.error(`Backup save ${collectionName} failed:`, err);
        }
    }
}

export async function getUserData(collectionName) {
    const user = await getActiveUser();
    if (!user) return null;

    if (userListCache[user.uid] && userListCache[user.uid][collectionName]) {
        return userListCache[user.uid][collectionName];
    }

    try {
        const userDocRef = doc(db, 'users', user.uid);
        const snap = await awaitWithTimeout(getDoc(userDocRef));
        if (snap?.exists()) {
            const val = snap.data()[collectionName];
            if (Array.isArray(val)) {
                if (!userListCache[user.uid]) userListCache[user.uid] = {};
                userListCache[user.uid][collectionName] = val;
                return val;
            }
        }
    } catch (err) {
        console.error(`Failed to read ${collectionName}:`, err);
    }

    try {
        const colDocRef = doc(db, collectionName, user.uid);
        const snap = await awaitWithTimeout(getDoc(colDocRef));
        if (snap?.exists()) {
            const val = snap.data().items;
            if (Array.isArray(val)) {
                if (!userListCache[user.uid]) userListCache[user.uid] = {};
                userListCache[user.uid][collectionName] = val;
                return val;
            }
        }
    } catch (err) {
        console.error(`Failed to read ${collectionName} backup:`, err);
    }
    return null;
}

export async function syncStorageToDb(key, dataArray) {
    const uniqueArray = deduplicateList(dataArray);
    localStorage.setItem(key, JSON.stringify(uniqueArray));
    return enqueueTask(key, async () => {
        try {
            await saveUserData(key, uniqueArray);
        } catch (error) {
            console.error(`Sync ${key} to DB failed:`, error);
        }
    });
}

export async function fetchDbToStorage(key) {
    return enqueueTask(key, async () => {
        const data = await getUserData(key);
        if (data !== null) {
            localStorage.setItem(key, JSON.stringify(data));
            return data;
        }
        return null;
    });
}

// Log saves, clicks, and watch rates in recommendationMetrics daily logs
export async function logRecommendationMetric(metricType, count = 1) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const docRef = doc(db, "recommendationMetrics", today);
        
        const snap = await awaitWithTimeout(getDoc(docRef), 1500);
        let data = (snap && snap.exists()) ? snap.data() : { clicks: 0, saves: 0, watches: 0, impressions: 0 };
        
        data[metricType] = (data[metricType] || 0) + count;
        
        const clicks = data.clicks || 0;
        const saves = data.saves || 0;
        const watches = data.watches || 0;
        data.accuracyScore = clicks > 0 ? Math.round(((saves + watches) / clicks) * 100) : 0;
        
        const { writeBatch } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const batch = writeBatch(db);
        batch.set(docRef, data, { merge: true });
        await awaitWithTimeout(batch.commit(), 1500);
        console.log(`[logRecommendationMetric] Metric "${metricType}" logged.`, data);
    } catch (e) {
        console.warn("logRecommendationMetric error:", e);
    }
}

// User Preference Tracking & Activity analytics
export async function trackUserActivity(item, actionType) {
    try {
        const user = await getActiveUser();
        if (!user || !item) return;

        // Track Recommendation Saves and Watch Rates
        if (item.fromRecommendation) {
            if (actionType === 'watch' || actionType === 'watched') {
                await logRecommendationMetric('watch');
            } else if (actionType === 'favorite' || actionType === 'mylist') {
                await logRecommendationMetric('save');
            }
        }

        // 1. Determine content type (Anime, Movie, TV)
        let type = 'TV';
        const t = (item.type || '').toString().toLowerCase();
        if (t === 'movie' || t === 'feature') {
            type = 'Movie';
        } else if (t === 'tv' || t === 'ona' || t === 'ova' || t === 'special' || t === 'anime') {
            type = 'Anime';
        } else {
            type = 'TV';
        }

        // 2. Map standard genres
        let genres = item.genres || [];
        if (genres.length === 0 && item.genre_ids) {
            const TMDB_MAP = {
                28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
                18: "Drama", 14: "Fantasy", 27: "Horror", 9648: "Mystery", 10749: "Romance",
                878: "Sci-Fi", 53: "Thriller", 10759: "Action & Adventure", 10765: "Sci-Fi & Fantasy"
            };
            genres = item.genre_ids.map(id => TMDB_MAP[id]).filter(Boolean);
        }
        if (typeof genres === 'string') {
            genres = genres.split(',').map(g => g.trim());
        }

        // 3. Load or initialize userPreferences
        const prefRef = doc(db, "userPreferences", user.uid);
        const prefSnap = await awaitWithTimeout(getDoc(prefRef), 1500);
        let prefs = (prefSnap && prefSnap.exists()) ? prefSnap.data() : {
            genres: {},
            animeGenres: {},
            movieGenres: {},
            tvGenres: {},
            types: {},
            watchingTimes: {},
            totalWatched: 0,
            accurateWatched: 0,
            accuracy: 0
        };

        // Increment content types
        prefs.types[type] = (prefs.types[type] || 0) + 1;

        // Record watching hour
        const currentHour = new Date().getHours().toString();
        prefs.watchingTimes[currentHour] = (prefs.watchingTimes[currentHour] || 0) + 1;

        // Tally genres
        if (genres && Array.isArray(genres)) {
            genres.forEach(genre => {
                const g = typeof genre === 'object' ? (genre.name || '') : genre;
                if (!g) return;
                prefs.genres[g] = (prefs.genres[g] || 0) + 1;
                if (type === 'Anime') {
                    prefs.animeGenres[g] = (prefs.animeGenres[g] || 0) + 1;
                } else if (type === 'Movie') {
                    prefs.movieGenres[g] = (prefs.movieGenres[g] || 0) + 1;
                } else {
                    prefs.tvGenres[g] = (prefs.tvGenres[g] || 0) + 1;
                }
            });
        }

        // Calculate accuracy on watches
        if (actionType === 'watch' || actionType === 'watched') {
            prefs.totalWatched = (prefs.totalWatched || 0) + 1;

            const sortedGenres = Object.entries(prefs.genres || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
            const matchesTopGenre = genres.some(genre => {
                const g = typeof genre === 'object' ? (genre.name || '') : genre;
                return sortedGenres.includes(g);
            });

            if (matchesTopGenre || sortedGenres.length === 0) {
                prefs.accurateWatched = (prefs.accurateWatched || 0) + 1;
            }

            prefs.accuracy = prefs.totalWatched > 0 
                ? Math.round((prefs.accurateWatched / prefs.totalWatched) * 100)
                : 85; // Default healthy baseline
        }

        await awaitWithTimeout(setDoc(prefRef, prefs, { merge: true }), 1500);

        // 4. Update genreAnalytics breakdown
        const analyticsRef = doc(db, "genreAnalytics", user.uid);
        const totalGenreCounts = Object.values(prefs.genres).reduce((a, b) => a + b, 0);
        const genreDistribution = Object.entries(prefs.genres).map(([genre, count]) => ({
            genre,
            count,
            percentage: totalGenreCounts > 0 ? Math.round((count / totalGenreCounts) * 100) : 0
        })).sort((a, b) => b.count - a.count);

        const totalTypes = Object.values(prefs.types).reduce((a, b) => a + b, 0);
        const contentTypeBreakdown = {};
        Object.entries(prefs.types).forEach(([contentType, count]) => {
            contentTypeBreakdown[contentType] = totalTypes > 0 ? Math.round((count / totalTypes) * 100) : 0;
        });

        await awaitWithTimeout(setDoc(analyticsRef, {
            genreDistribution,
            contentTypeBreakdown,
            updatedAt: new Date().toISOString()
        }, { merge: true }), 1500);

    } catch (e) {
        console.error("trackUserActivity error:", e);
    }
}

// AI Phase 1: Smart Recommendation Engine - Preferences Analyzer
export async function analyzeUserPreferences() {
    try {
        const user = await getActiveUser();
        if (!user) return null;

        const history   = (await getUserData("watchHistory")) || [];
        const favorites = (await getUserData("favorites"))    || [];
        const watched   = (await getUserData("watched"))      || [];
        const myList    = (await getUserData("myList"))       || [];

        const allItems = [...history, ...favorites, ...watched, ...myList];
        
        const genreTally = {};
        const typeTally = {};
        const viewCountTally = {};

        allItems.forEach(item => {
            if (!item) return;

            // Media Type Tally
            const type = (item.mediaType || item.type || 'anime').toLowerCase();
            typeTally[type] = (typeTally[type] || 0) + 1;

            // Genres Tally
            let genres = [];
            if (Array.isArray(item.genres)) genres = item.genres;
            else if (typeof item.genres === 'string') genres = item.genres.split(',').map(s => s.trim());
            else if (item.genre) genres = [item.genre];

            genres.forEach(g => {
                const genreName = typeof g === 'object' ? (g.name || '') : g;
                if (genreName) {
                    genreTally[genreName] = (genreTally[genreName] || 0) + 1;
                }
            });

            // Most Viewed Content (approximated by frequency across lists)
            const title = item.title || item.name;
            if (title) {
                viewCountTally[title] = (viewCountTally[title] || 0) + 1;
            }
        });

        const topGenres = Object.entries(genreTally)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(e => e[0]);

        const favoriteType = Object.entries(typeTally)
            .sort((a, b) => b[1] - a[1])
            .map(e => e[0])[0] || 'anime';

        const mostViewedContent = Object.entries(viewCountTally)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(e => e[0]);

        const userPreferences = {
            topGenres,
            favoriteType,
            mostViewedContent,
            lastUpdated: new Date().toISOString()
        };

        // Write to Firestore
        const prefRef = doc(db, "userPreferences", user.uid);
        await awaitWithTimeout(setDoc(prefRef, userPreferences, { merge: true }), 1500);

        // Cache in-memory
        userPrefsCache[user.uid] = userPreferences;

        return userPreferences;
    } catch (e) {
        console.error("analyzeUserPreferences error:", e);
        return null;
    }
}

export async function getPreferences() {
    try {
        const user = await getActiveUser();
        if (!user) return { genres: {}, types: {} };
        
        if (userPrefsCache[user.uid]) {
            return userPrefsCache[user.uid];
        }

        const prefRef = doc(db, "userPreferences", user.uid);
        const snap = await awaitWithTimeout(getDoc(prefRef));
        const data = snap?.exists() ? snap.data() : { genres: {}, types: {} };
        userPrefsCache[user.uid] = data;
        return data;
    } catch (e) {
        console.error("getPreferences failed:", e);
        return { genres: {}, types: {} };
    }
}

// Compute analytics summary for the profile dashboard
export async function getAnalytics() {
    const history   = (await getUserData("watchHistory")) || [];
    const watched   = (await getUserData("watched"))      || [];
    const favorites = (await getUserData("favorites"))    || [];
    const myList    = (await getUserData("myList"))       || [];
    const continueWatching = (await getUserData("continueWatching")) || [];
    const prefs     = await getPreferences();

    // AI Phase 1: Retrieve exact top genres and types using new logic
    const analyzedPrefs = await analyzeUserPreferences();
    
    const topGenre = analyzedPrefs && analyzedPrefs.topGenres && analyzedPrefs.topGenres.length > 0
        ? analyzedPrefs.topGenres[0]
        : 'N/A';

    const topType = analyzedPrefs && analyzedPrefs.favoriteType
        ? analyzedPrefs.favoriteType
        : 'N/A';

    // Calculate Average Rating of Watched Content
    const ratings = watched
        .map(i => {
            const r = i.rating || i.vote_average || i.score;
            return r ? parseFloat(r) : null;
        })
        .filter(r => r !== null && !isNaN(r) && r > 0);

    const avgRating = ratings.length > 0
        ? (ratings.reduce((sum, val) => sum + val, 0) / ratings.length).toFixed(1)
        : 'N/A';

    return {
        historyCount:   history.length,
        watchedCount:   watched.length,
        favoritesCount: favorites.length,
        myListCount:    myList.length,
        continueWatchingCount: continueWatching.length,
        topGenre,
        topType,
        avgRating,
        accuracy:       prefs.accuracy !== undefined ? prefs.accuracy : (watched.length > 0 ? 85 : 0),
        recentTitles:   history.slice(0, 5).map(i => i.title),
    };
}

// Recommendations caching helpers
export async function saveRecommendations(recs) {
    try {
        const user = await getActiveUser();
        if (!user) return;

        // Cache in memory
        recsCache[user.uid] = {
            ...recs,
            generatedAt: new Date().toISOString()
        };

        const recsRef = doc(db, "recommendations", user.uid);
        await awaitWithTimeout(setDoc(recsRef, recsCache[user.uid], { merge: true }), 1500);
    } catch (e) {
        console.warn("saveRecommendations error:", e);
    }
}

export async function fetchCachedRecommendations() {
    try {
        const user = await getActiveUser();
        if (!user) return null;

        if (recsCache[user.uid]) {
            return recsCache[user.uid];
        }

        const recsRef = doc(db, "recommendations", user.uid);
        const snap = await awaitWithTimeout(getDoc(recsRef), 1500);
        if (snap && snap.exists()) {
            const data = snap.data();
            recsCache[user.uid] = data;
            return data;
        }
        return null;
    } catch (e) {
        console.warn("fetchCachedRecommendations error:", e);
        return null;
    }
}

export { auth, doc, setDoc, getDoc, updateDoc };
