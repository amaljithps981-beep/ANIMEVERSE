import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCZWdwzHo5IRGWQHs6IzsFtXdoLm10gmII",
  authDomain: "animeverse-4c635.firebaseapp.com",
  projectId: "animeverse-4c635",
  storageBucket: "animeverse-4c635.firebasestorage.app",
  messagingSenderId: "200334860457",
  appId: "1:200334860457:web:d493dd34a5f541d9e8c9b8",
  measurementId: "G-8VMLXQFDWY"
};

const app  = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/**
 * Returns a Promise that resolves with the authenticated user,
 * or redirects to login.html if there is no user.
 */
export function requireAuth() {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe(); // stop listening after first resolution
            if (user) {
                resolve(user);
            } else {
                window.location.href = "login.html";
            }
        });
    });
}

/**
 * Returns a Promise that resolves if the user is an admin.
 * Otherwise, redirects to index.html.
 */
export function requireAdmin() {
    return new Promise((resolve) => {
        requireAuth().then(async (user) => {
            try {
                const userDocRef = doc(db, "users", user.uid);
                const userSnap = await getDoc(userDocRef);
                if (userSnap.exists() && userSnap.data().role === "admin") {
                    resolve(user);
                } else {
                    console.warn("Blocked non-admin access to admin dashboard.");
                    window.location.href = "index.html";
                }
            } catch (err) {
                console.error("Error verifying admin role:", err);
                window.location.href = "index.html";
            }
        });
    });
}
