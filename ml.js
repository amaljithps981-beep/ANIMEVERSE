/**
 * ml.js
 * AI Phase 2: Dataset Generation & ML Preparation
 */
import { db } from './db.js';
import { collection, getDocs, writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── 1. User Activity Dataset Generator ──────────────────────────────
export function buildUserDataset(uid, history, favorites, watched, myList) {
    const rawItems = [];

    const processList = (list, statusOverride) => {
        if (!list) return;
        list.forEach(item => {
            if (!item) return;
            const contentId = item.mal_id || item.id || Math.floor(Math.random() * 1000000);
            const title = item.title || item.name || "Unknown";
            
            let genres = [];
            if (Array.isArray(item.genres)) {
                genres = item.genres.map(g => typeof g === 'object' ? g.name : g).filter(Boolean);
            } else if (typeof item.genres === 'string') {
                genres = item.genres.split(',').map(g => g.trim()).filter(Boolean);
            } else if (item.genre) {
                genres = [item.genre];
            }

            const mediaType = (item.mediaType || item.media_type || item.type || 'anime').toLowerCase();
            const rating = parseFloat(item.vote_average || item.score || item.rating || 0);
            
            rawItems.push({
                uid,
                contentId,
                title,
                genres,
                mediaType,
                rating,
                favorite: statusOverride.favorite || false,
                watched: statusOverride.watched || false,
                myList: statusOverride.myList || false,
                views: 1, 
                timestamp: item.addedAt || new Date().toISOString()
            });
        });
    };

    processList(history, { favorite: false, watched: false, myList: false });
    processList(favorites, { favorite: true, watched: false, myList: false });
    processList(watched, { favorite: false, watched: true, myList: false });
    processList(myList, { favorite: false, watched: false, myList: true });

    return rawItems;
}

// ── 2. Data Cleaning ────────────────────────────────────────────────
export function cleanDataset(dataset) {
    const cleaned = [];
    const seen = new Map();

    dataset.forEach(record => {
        if (!record.contentId || !record.title || record.title === "Unknown") return;

        let mt = record.mediaType;
        if (mt === 'tv' || mt === 'movie' || mt === 'anime') {
        } else if (mt === 'feature' || mt === 'film') {
            mt = 'movie';
        } else if (mt === 'series' || mt === 'ona' || mt === 'ova') {
            mt = 'anime';
        } else {
            mt = 'anime';
        }
        record.mediaType = mt;

        const key = `${record.uid}_${record.contentId}`;
        if (seen.has(key)) {
            const existing = seen.get(key);
            existing.favorite = existing.favorite || record.favorite;
            existing.watched = existing.watched || record.watched;
            existing.myList = existing.myList || record.myList;
            existing.views += 1;
            existing.genres = [...new Set([...existing.genres, ...record.genres])];
        } else {
            seen.set(key, record);
            cleaned.push(record);
        }
    });

    return Array.from(seen.values());
}

// ── 3. Feature Engineering ──────────────────────────────────────────
export function extractFeatures(cleanedDataset) {
    let totalItems = cleanedDataset.length;
    let totalFavorites = 0;
    let totalWatched = 0;
    const genreTally = {};
    const typeTally = {};

    cleanedDataset.forEach(item => {
        if (item.favorite) totalFavorites++;
        if (item.watched) totalWatched++;
        
        item.genres.forEach(g => {
            genreTally[g] = (genreTally[g] || 0) + 1;
        });

        typeTally[item.mediaType] = (typeTally[item.mediaType] || 0) + 1;
    });

    const genreFrequency = {};
    for (const [g, count] of Object.entries(genreTally)) {
        genreFrequency[`${g.toLowerCase()}Score`] = totalItems > 0 ? Math.round((count / totalItems) * 100) : 0;
    }

    const contentTypePreference = {};
    for (const [t, count] of Object.entries(typeTally)) {
        contentTypePreference[`${t.toLowerCase()}Preference`] = totalItems > 0 ? Math.round((count / totalItems) * 100) : 0;
    }

    const favoriteRatio = totalItems > 0 ? Math.round((totalFavorites / totalItems) * 100) : 0;
    const watchFrequency = totalItems > 0 ? Math.round((totalWatched / totalItems) * 100) : 0;

    return {
        ...genreFrequency,
        ...contentTypePreference,
        favoriteRatio,
        watchFrequency
    };
}

// ── 4. Export System ────────────────────────────────────────────────
export function exportDatasetAsJSON(aggregatedData) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(aggregatedData, null, 2));
    const node = document.createElement('a');
    node.setAttribute("href", dataStr);
    node.setAttribute("download", "dataset.json");
    document.body.appendChild(node);
    node.click();
    node.remove();
}

export function exportDatasetAsCSV(aggregatedData) {
    if (aggregatedData.length === 0) return;
    
    const headersSet = new Set();
    aggregatedData.forEach(item => {
        Object.keys(item).forEach(k => headersSet.add(k));
    });
    const headers = Array.from(headersSet);
    
    let csvStr = headers.join(",") + "\n";
    
    aggregatedData.forEach(item => {
        const row = headers.map(header => {
            let val = item[header];
            if (val === undefined || val === null) val = "";
            if (Array.isArray(val)) val = val.join(';');
            if (typeof val === 'string') {
                val = val.replace(/"/g, '""');
                if (val.includes(",") || val.includes("\n") || val.includes(";")) {
                    val = `"${val}"`;
                }
            }
            return val;
        });
        csvStr += row.join(",") + "\n";
    });

    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvStr);
    const node = document.createElement('a');
    node.setAttribute("href", dataStr);
    node.setAttribute("download", "dataset.csv");
    document.body.appendChild(node);
    node.click();
    node.remove();
}

// ── Future ML Forecasting Dataset Builder ─────────────────────────────────────
export function buildForecastingDataset(history, favorites, watched, myList) {
    const logs = [];
    const addLogs = (list, type, weight) => {
        if (!list) return;
        list.forEach(item => {
            if (!item) return;
            const date = item.addedAt ? new Date(item.addedAt) : new Date();
            logs.push({
                timestamp: date.toISOString(),
                dateStr: date.toISOString().split('T')[0],
                hour: date.getHours(),
                type: type,
                weight: weight,
                title: item.title || item.name || '',
                genres: Array.isArray(item.genres) 
                    ? item.genres.map(g => typeof g === 'object' ? g.name : g).join(';') 
                    : (item.genres || '')
            });
        });
    };
    addLogs(history, 'watch', 1.0);
    addLogs(favorites, 'favorite', 2.0);
    addLogs(watched, 'watched', 1.5);
    addLogs(myList, 'watchlist', 0.5);

    // Sort chronologically
    logs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    return logs;
}

// ── 5. Platform Generator ───────────────────────────────────────────
export async function generatePlatformDataset() {
    try {
        const usersSnap = await getDocs(collection(db, "users"));
        let totalRecords = 0;
        let totalUsers = 0;
        
        let batch = writeBatch(db);
        let batchCount = 0;
        const aggregatedDataset = [];

        for (const userDoc of usersSnap.docs) {
            const uid = userDoc.id;
            const data = userDoc.data();
            
            const history = data.watchHistory || [];
            const favorites = data.favorites || [];
            const watched = data.watched || [];
            const myList = data.myList || [];
            
            if (history.length === 0 && favorites.length === 0 && watched.length === 0 && myList.length === 0) continue;

            totalUsers++;
            const rawDataset = buildUserDataset(uid, history, favorites, watched, myList);
            const cleanedDataset = cleanDataset(rawDataset);
            const features = extractFeatures(cleanedDataset);
            const forecastingLogs = buildForecastingDataset(history, favorites, watched, myList);

            totalRecords += cleanedDataset.length;
            
            // Collect for the massive array
            cleanedDataset.forEach(item => aggregatedDataset.push(item));

            const payload = {
                dataset: cleanedDataset,
                features: features,
                forecastingLogs: forecastingLogs,
                generatedAt: new Date().toISOString()
            };

            const mlRef = doc(db, "mlDataset", uid);
            batch.set(mlRef, payload, { merge: true });
            batchCount++;

            if (batchCount >= 450) { // Firestore limit is 500
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        return { success: true, totalRecords, totalUsers, aggregatedDataset };
    } catch (e) {
        console.error("Error generating platform dataset:", e);
        return { success: false, error: e.message };
    }
}
