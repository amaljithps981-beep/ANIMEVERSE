import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCZWdwzHo5IRGWQHs6IzsFtXdoLm10gmII",
  authDomain: "animeverse-4c635.firebaseapp.com",
  projectId: "animeverse-4c635",
  storageBucket: "animeverse-4c635.firebasestorage.app",
  messagingSenderId: "200334860457",
  appId: "1:200334860457:web:d493dd34a5f541d9e8c9b8",
  measurementId: "G-8VMLXQFDWY"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let isAuthInitialized = false;
let authResolve;
export const authReady = new Promise((resolve) => {
    authResolve = resolve;
});

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    isAuthInitialized = true;
    authResolve(user);
    // NOTE: Do NOT redirect here. db.js is a data layer only.
    // Auth redirects are handled by firebase.js (for index.html)
    // and guard.js (for protected list pages).
});

export async function getActiveUser() {
    if (isAuthInitialized) return currentUser;
    return await authReady;
}


// Deduplicate a list of items by case-insensitive, trimmed title or name
export function deduplicateList(dataArray) {
    console.log('[deduplicateList] Input:', dataArray);
    if (!dataArray || !Array.isArray(dataArray)) {
        console.warn('[deduplicateList] Invalid input — returning []');
        return [];
    }
    const uniqueMap = new Map();
    dataArray.forEach(item => {
        if (!item) return;
        const title = item.title || item.name;
        if (!title) {
            console.warn('[deduplicateList] Item has no title/name, skipping:', item);
            return;
        }
        const key = title.toLowerCase().trim();
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, item);
        }
    });
    const result = Array.from(uniqueMap.values()).map(item => {
        if (!item.addedAt) {
            item.addedAt = new Date().toISOString();
        }
        return item;
    });
    console.log('[deduplicateList] Output:', result);
    return result;
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

// Await a promise with a timeout, resolving to null if the timeout expires
export async function awaitWithTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            console.warn(`awaitWithTimeout: timed out after ${timeoutMs}ms`);
            resolve(null);
        }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
}

// Save user list data to Firestore
// PRIMARY PATH: /users/{uid} document, field = collectionName
// BACKUP PATH:  /{collectionName}/{uid} document, field = items
export async function saveUserData(collectionName, dataArray) {
    const user = await getActiveUser();
    if (!user) {
        console.warn(`[saveUserData] No user — skipping Firestore write for "${collectionName}"`);
        return;
    }

    console.log(`[saveUserData] Writing "${collectionName}" for uid=${user.uid}. Items: ${dataArray.length}`);
    console.log(`[saveUserData] Payload:`, dataArray);

    let primaryOk = false;
    let backupOk  = false;

    // PRIMARY: store array as a field in /users/{uid}
    try {
        const userDocRef = doc(db, 'users', user.uid);
        const res = await awaitWithTimeout(setDoc(userDocRef, { [collectionName]: dataArray }, { merge: true }), 1500);
        if (res !== null) {
            console.log(`[saveUserData] ✅ PRIMARY write success: /users/${user.uid}.${collectionName}`);
            primaryOk = true;
        } else {
            console.warn(`[saveUserData] ❌ PRIMARY write TIMED OUT: /users/${user.uid}.${collectionName}`);
        }
    } catch (err) {
        console.error(`[saveUserData] ❌ PRIMARY write FAILED: /users/${user.uid}.${collectionName}`, err);
    }

    // BACKUP: store array in /{collectionName}/{uid}.items
    try {
        const colDocRef = doc(db, collectionName, user.uid);
        const res = await awaitWithTimeout(setDoc(colDocRef, { items: dataArray }, { merge: true }), 1500);
        if (res !== null) {
            console.log(`[saveUserData] ✅ BACKUP write success: /${collectionName}/${user.uid}`);
            backupOk = true;
        } else {
            console.warn(`[saveUserData] ❌ BACKUP write TIMED OUT: /${collectionName}/${user.uid}`);
        }
    } catch (err) {
        console.error(`[saveUserData] ❌ BACKUP write FAILED: /${collectionName}/${user.uid}`, err);
    }

    if (!primaryOk && !backupOk) {
        console.error(`[saveUserData] ❌❌ ALL write paths FAILED for "${collectionName}". Data NOT persisted to Firestore.`);
    }
}

// Read user list data from Firestore
// Tries PRIMARY path first, then BACKUP
export async function getUserData(collectionName) {
    const user = await getActiveUser();
    if (!user) {
        console.warn(`[getUserData] No user — cannot read "${collectionName}"`);
        return null;
    }

    console.log(`[getUserData] Reading "${collectionName}" for uid=${user.uid}`);

    // PRIMARY: read field from /users/{uid}
    try {
        const userDocRef = doc(db, 'users', user.uid);
        const snap = await awaitWithTimeout(getDoc(userDocRef), 1500);
        if (snap && snap.exists()) {
            const dataObj = snap.data();
            if (collectionName in dataObj) {
                const val = dataObj[collectionName];
                if (Array.isArray(val)) {
                    console.log(`[getUserData] ✅ PRIMARY read success: /users/${user.uid}.${collectionName}. Count: ${val.length}`);
                    return val;
                }
            }
            console.warn(`[getUserData] PRIMARY path exists but field "${collectionName}" is empty/missing.`);
        } else {
            console.warn(`[getUserData] PRIMARY /users/${user.uid} document does NOT exist yet or read timed out.`);
        }
    } catch (err) {
        console.error(`[getUserData] ❌ PRIMARY read FAILED: /users/${user.uid}.${collectionName}`, err);
    }

    // BACKUP: read from /{collectionName}/{uid}.items
    try {
        const colDocRef = doc(db, collectionName, user.uid);
        const snap = await awaitWithTimeout(getDoc(colDocRef), 1500);
        if (snap && snap.exists()) {
            const dataObj = snap.data();
            if ('items' in dataObj) {
                const val = dataObj.items;
                if (Array.isArray(val)) {
                    console.log(`[getUserData] ✅ BACKUP read success: /${collectionName}/${user.uid}. Count: ${val.length}`);
                    return val;
                }
            }
            console.warn(`[getUserData] BACKUP path exists but items field is empty/missing.`);
        } else {
            console.warn(`[getUserData] /${collectionName}/${user.uid} document does NOT exist yet or read timed out.`);
        }
    } catch (err) {
        console.error(`[getUserData] ❌ BACKUP read FAILED: /${collectionName}/${user.uid}`, err);
    }

    console.warn(`[getUserData] Nothing found for "${collectionName}" in any Firestore path. Returning null.`);
    return null;
}

// Wrapper to replace localStorage logic with strict duplicate prevention and sequential queueing
export async function syncStorageToDb(key, dataArray) {
    console.log(`[syncStorageToDb] key="${key}" | Before dedupe:`, dataArray);
    const uniqueArray = deduplicateList(dataArray);
    console.log(`[syncStorageToDb] key="${key}" | After dedupe:`, uniqueArray);

    // Save to local storage synchronously for instantaneous UI update
    localStorage.setItem(key, JSON.stringify(uniqueArray));
    console.log(`[syncStorageToDb] key="${key}" | Written to localStorage. Count: ${uniqueArray.length}`);

    // Enqueue Firestore write
    return enqueueTask(key, async () => {
        try {
            await saveUserData(key, uniqueArray);
            console.log(`[syncStorageToDb] key="${key}" | Firestore write completed`);
        } catch (error) {
            console.error(`[syncStorageToDb] key="${key}" | Firestore write FAILED:`, error);
        }
    });
}

export async function fetchDbToStorage(key) {
    return enqueueTask(key, async () => {
        console.log(`[fetchDbToStorage] key="${key}" | Starting Firestore read...`);
        const data = await getUserData(key);
        console.log(`[fetchDbToStorage] key="${key}" | Firestore read result:`, data);

        if (data !== null) {
            localStorage.setItem(key, JSON.stringify(data));
            console.log(`[fetchDbToStorage] key="${key}" | localStorage updated. Count: ${data.length}`);
            return data;
        }

        console.warn(`[fetchDbToStorage] key="${key}" | getUserData returned null (no user/no record/timed out). localStorage untouched.`);
        return null;
    });
}

// User Preference Tracking & Activity analytics
export async function trackUserActivity(item, actionType) {
    try {
        const user = await getActiveUser();
        if (!user || !item) return;

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
        await setDoc(prefRef, userPreferences, { merge: true });

        return userPreferences;
    } catch (e) {
        console.error("analyzeUserPreferences error:", e);
        return null;
    }
}

// Read user's preference scores from Firestore
export async function getPreferences() {
    try {
        const user = await getActiveUser();
        if (!user) return { genres: {}, animeGenres: {}, movieGenres: {}, tvGenres: {}, types: {}, watchingTimes: {} };
        const prefRef = doc(db, "userPreferences", user.uid);
        const snap = await awaitWithTimeout(getDoc(prefRef), 1500);
        return (snap && snap.exists()) ? snap.data() : { genres: {}, animeGenres: {}, movieGenres: {}, tvGenres: {}, types: {}, watchingTimes: {} };
    } catch (e) {
        console.warn("getPreferences error:", e);
        return { genres: {}, animeGenres: {}, movieGenres: {}, tvGenres: {}, types: {}, watchingTimes: {} };
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
        const recsRef = doc(db, "recommendations", user.uid);
        await awaitWithTimeout(setDoc(recsRef, {
            ...recs,
            generatedAt: new Date().toISOString()
        }, { merge: true }), 1500);
    } catch (e) {
        console.warn("saveRecommendations error:", e);
    }
}

export async function fetchCachedRecommendations() {
    try {
        const user = await getActiveUser();
        if (!user) return null;
        const recsRef = doc(db, "recommendations", user.uid);
        const snap = await awaitWithTimeout(getDoc(recsRef), 1500);
        return (snap && snap.exists()) ? snap.data() : null;
    } catch (e) {
        console.warn("fetchCachedRecommendations error:", e);
        return null;
    }
}

export { auth, db, doc, setDoc, getDoc, updateDoc };
