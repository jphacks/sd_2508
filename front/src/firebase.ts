import {initializeApp} from "firebase/app";
import {getFirestore} from "firebase/firestore";
import {getDatabase} from "firebase/database";
import {getAuth} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCdbV5rI7dV5PTKyVkhNQduNRdlbU_KPJ8",
  authDomain: "mimamoricard-2b3f6.firebaseapp.com",
  databaseURL: "https://mimamoricard-2b3f6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mimamoricard-2b3f6",
  storageBucket: "mimamoricard-2b3f6.firebasestorage.app",
  messagingSenderId: "986156854425",
  appId: "1:986156854425:web:2269e789c307fe8e3f9c08",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const auth = getAuth(app);
