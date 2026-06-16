import { db, getActiveUser } from './db.js';
import { doc, setDoc, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

class AnalyticsManager {
    constructor() {
        this.queue = {
            detailViews: {},
            trailerClicks: 0,
            searchQueries: {},
            failedSearches: {},
            recommendationSaves: 0
        };
        this.flushInterval = 30000; // 30 seconds
        
        // Auto flush
        setInterval(() => this.flush(), this.flushInterval);
        window.addEventListener("beforeunload", () => this.flushSync());
        
        // Log daily active user automatically on init
        this.logActiveUser();
    }

    async logActiveUser() {
        try {
            const user = await getActiveUser();
            if (!user) return;
            const dateStr = new Date().toISOString().split('T')[0];
            const ref = doc(db, "analytics", dateStr);
            await setDoc(ref, {
                [`activeUsers.${user.uid}`]: true,
                visits: increment(1)
            }, { merge: true });
            
            // Log to users collection for "lastActive"
            const userRef = doc(db, "users", user.uid);
            await setDoc(userRef, { lastActive: new Date().toISOString() }, { merge: true });
        } catch (e) {
            console.warn("Error logging active user", e);
        }
    }

    trackDetailView(title) {
        if (!title) return;
        const key = title.replace(/[\.\#\$\/\[\]]/g, "_");
        this.queue.detailViews[key] = (this.queue.detailViews[key] || 0) + 1;
    }

    trackTrailerClick() {
        this.queue.trailerClicks++;
    }

    trackSearch(query, isSuccess) {
        if (!query) return;
        const q = query.toLowerCase().trim().replace(/[\.\#\$\/\[\]]/g, "_");
        if (isSuccess) {
            this.queue.searchQueries[q] = (this.queue.searchQueries[q] || 0) + 1;
        } else {
            this.queue.failedSearches[q] = (this.queue.failedSearches[q] || 0) + 1;
        }
    }

    trackRecommendationSave() {
        this.queue.recommendationSaves++;
    }

    async flush() {
        if (Object.keys(this.queue.detailViews).length === 0 && 
            this.queue.trailerClicks === 0 && 
            Object.keys(this.queue.searchQueries).length === 0 &&
            Object.keys(this.queue.failedSearches).length === 0 &&
            this.queue.recommendationSaves === 0) {
            return;
        }

        const currentQueue = { ...this.queue };
        this.queue = {
            detailViews: {},
            trailerClicks: 0,
            searchQueries: {},
            failedSearches: {},
            recommendationSaves: 0
        };

        try {
            const dateStr = new Date().toISOString().split('T')[0];
            
            // 1. Flush engagement analytics
            if (Object.keys(currentQueue.detailViews).length > 0 || currentQueue.trailerClicks > 0) {
                const engRef = doc(db, "engagementAnalytics", dateStr);
                const engUpdates = { trailerClicks: increment(currentQueue.trailerClicks) };
                for (const [title, count] of Object.entries(currentQueue.detailViews)) {
                    engUpdates[`detailViews.${title}`] = increment(count);
                }
                await setDoc(engRef, engUpdates, { merge: true });
            }

            // 2. Flush search analytics
            if (Object.keys(currentQueue.searchQueries).length > 0 || Object.keys(currentQueue.failedSearches).length > 0) {
                const searchRef = doc(db, "searchAnalytics", dateStr);
                const searchUpdates = {};
                for (const [q, count] of Object.entries(currentQueue.searchQueries)) {
                    searchUpdates[`successful.${q}`] = increment(count);
                }
                for (const [q, count] of Object.entries(currentQueue.failedSearches)) {
                    searchUpdates[`failed.${q}`] = increment(count);
                }
                await setDoc(searchRef, searchUpdates, { merge: true });
            }

            // 3. Flush recommendation saves
            if (currentQueue.recommendationSaves > 0) {
                const recRef = doc(db, "analytics", "recommendations");
                await setDoc(recRef, { saves: increment(currentQueue.recommendationSaves) }, { merge: true });
            }

        } catch (e) {
            console.warn("Analytics flush error:", e);
            // Restore queue if failed
            for (const [k, v] of Object.entries(currentQueue.detailViews)) {
                this.queue.detailViews[k] = (this.queue.detailViews[k] || 0) + v;
            }
            this.queue.trailerClicks += currentQueue.trailerClicks;
            this.queue.recommendationSaves += currentQueue.recommendationSaves;
            for (const [k, v] of Object.entries(currentQueue.searchQueries)) {
                this.queue.searchQueries[k] = (this.queue.searchQueries[k] || 0) + v;
            }
            for (const [k, v] of Object.entries(currentQueue.failedSearches)) {
                this.queue.failedSearches[k] = (this.queue.failedSearches[k] || 0) + v;
            }
        }
    }

    flushSync() {
        this.flush();
    }
}

export const analytics = new AnalyticsManager();
