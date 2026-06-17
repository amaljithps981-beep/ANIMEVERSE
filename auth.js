import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG, DEFAULT_AVATAR } from './config.js';

const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

const email = document.getElementById("email");
const password = document.getElementById("password");
const signupBtn = document.getElementById("signupBtn");
const loginBtn = document.getElementById("loginBtn");

signupBtn.addEventListener("click", async () => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email.value, password.value);
    const user = userCredential.user;
    const isAdmin = email.value.toLowerCase().includes("admin");

    await setDoc(doc(db, "users", user.uid), {
      email: user.email,
      displayName: isAdmin ? "Platform Admin" : "Anime Fan",
      photoURL: DEFAULT_AVATAR,
      role: isAdmin ? "admin" : "user",
      createdAt: new Date().toISOString()
    });

    alert("Signup Successful 😄");
    window.location.href = "index.html";
  } catch (error) {
    alert(error.message);
  }
});

loginBtn.addEventListener("click", async () => {
  try {
    await signInWithEmailAndPassword(auth, email.value, password.value);
    alert("Login Successful 😄");
    window.location.href = "index.html";
  } catch (error) {
    alert(error.message);
  }
});