import { initializeApp, getApps, getApp }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* FIREBASE CONFIG */

const firebaseConfig = {

  apiKey: "AIzaSyCZWdwzHo5IRGWQHs6IzsFtXdoLm10gmII",

  authDomain: "animeverse-4c635.firebaseapp.com",

  projectId: "animeverse-4c635",

  storageBucket: "animeverse-4c635.firebasestorage.app",

  messagingSenderId: "200334860457",

  appId: "1:200334860457:web:d493dd34a5f541d9e8c9b8",

  measurementId: "G-8VMLXQFDWY"
};

/* INITIALIZE */

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* INPUTS */

const email =
document.getElementById("email");

const password =
document.getElementById("password");

const signupBtn =
document.getElementById("signupBtn");

const loginBtn =
document.getElementById("loginBtn");

/* SIGNUP */

signupBtn.addEventListener("click", ()=>{

    createUserWithEmailAndPassword(

        auth,

        email.value,

        password.value

    )

    .then(async (userCredential)=>{
        const user = userCredential.user;
        const role = email.value.toLowerCase().includes("admin") ? "admin" : "user";
        // Create basic profile
        await setDoc(doc(db, "users", user.uid), {
            email: user.email,
            displayName: role === "admin" ? "Platform Admin" : "Anime Fan",
            photoURL: "https://i.pinimg.com/736x/8b/16/7a/8b167af653c2399dd93b952a48740620.jpg",
            role: role,
            createdAt: new Date().toISOString()
        });

        alert("Signup Successful 😄");
        window.location.href = "index.html";
    })
    .catch(error=>{

        alert(error.message);

    });
});

/* LOGIN */

loginBtn.addEventListener("click", ()=>{

    signInWithEmailAndPassword(

        auth,

        email.value,

        password.value

    )

    .then(()=>{

        alert("Login Successful 😄");

        window.location.href =
        "index.html";

    })

    .catch(error=>{

        alert(error.message);

    });
});