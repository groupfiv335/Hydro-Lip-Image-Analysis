import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Droplets, AlertCircle, CheckCircle2, RefreshCcw, Info, Activity, History, Calendar, Trash2, FlipHorizontal, ArrowRight, ShieldCheck } from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, onSnapshot, query, deleteDoc, Timestamp } from 'firebase/firestore';

// --- Configuration & Constants ---
// HARDCODED API KEY FOR IMMEDIATE FIX
const apiKey = "AIzaSyDCIth7LpAAm_-F5b2i-xg6Js5DSg5yk_A";
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";

// --- FIREBASE CONFIGURATION ---
// IMPORTANT: You still need to paste your actual Firebase object here from the Firebase Console
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abcdefg"
};

// --- Initializing Firebase Safely ---
let app, auth, db;
const appId = 'lip-health-app-v1';

const initFirebase = () => {
  try {
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_")) {
      if (!getApps().length) {
        app = initializeApp(firebaseConfig);
      } else {
        app = getApps()[0];
      }
      auth = getAuth(app);
      db = getFirestore(app);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
};

const firebaseIsReady = initFirebase();

const App = () => {
  const [user, setUser] = useState(null);
  const [image, setImage] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('analyze');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState('user'); 
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [step, setStep] = useState(1);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!firebaseIsReady || !auth) return;
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db || !firebaseIsReady) return;
    setLoadingHistory(true);
    const historyRef = collection(db, 'users', user.uid, 'lip_history');
    
    const unsubscribe = onSnapshot(historyRef, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sorted = items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setHistory(sorted);
      setLoadingHistory(false);
    }, (err) => {
      setLoadingHistory(false);
    });
    return () => unsubscribe();
  }, [user]);

  const startCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera not supported on this browser.");
      return;
    }
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } 
      });
      streamRef.current = stream;
      setIsCameraOpen(true);
      setStep(2);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(console.error);
        }
      }, 300);
    } catch (err) {
      setError("Camera access denied.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (canvas && video) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setImage(canvas.toDataURL('image/png'));
      setStep(2);
      stopCamera();
    }
  };

  const analyzeLipHealth = async () => {
    if (!image) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const base64Image = image.split(',')[1];
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Analyze lip hydration." }, { inlineData: { mimeType: "image/png", data: base64Image } }] }],
          systemInstruction: { parts: [{ text: "Return JSON: { dehydration_status, metrics: { crack_intensity, dryness_level, moisture_score }, summary, recommendations: [] }" }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      
      const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
      setResult(parsed);
      setStep(3);

      if (db && user) {
        await addDoc(collection(db, 'users', user.uid, 'lip_history'), {
          ...parsed, timestamp: Timestamp.now(), thumbnail: image 
        });
      }
    } catch (err) {
      setError("Analysis failed: " + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const reset = () => {
    setImage(null); setResult(null); setError(null); setStep(1); stopCamera();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-20">
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800 px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className="text-blue-600 w-6 h-6" />
          <span className="font-bold text-lg tracking-tight">LipHydrate AI</span>
        </div>
        <button onClick={() => setActiveTab(activeTab === 'analyze' ? 'history' : 'analyze')} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
          {activeTab === 'analyze' ? <History className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
        </button>
      </header>

      <main className="max-w-xl mx-auto p-4 pt-8">
        {activeTab === 'analyze' ? (
          <div className="space-y-6">
            {step === 1 && (
              <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] shadow-xl border border-slate-100 dark:border-slate-800 text-center space-y-6">
                <div className="space-y-2">
                  <h1 className="text-3xl font-black italic">Lip Scan</h1>
                  <p className="text-slate-500">Check your hydration levels instantly.</p>
                </div>
                <div className="flex flex-col gap-4">
                  <button onClick={startCamera} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-transform">
                    <Camera className="w-6 h-6" /> Take Photo
                  </button>
                  <label className="w-full py-4 border-2 border-slate-200 dark:border-slate-800 rounded-2xl font-bold cursor-pointer flex items-center justify-center gap-3">
                    <Upload className="w-5 h-5" /> Upload Photo
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => { setImage(ev.target.result); setStep(2); };
                        reader.readAsDataURL(file);
                      }
                    }} />
                  </label>
                </div>
              </div>
            )}

            {isCameraOpen && (
              <div className="relative rounded-[2rem] overflow-hidden bg-black aspect-[3/4] shadow-2xl border-4 border-white/10">
                <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`} />
                <div className="absolute inset-x-0 bottom-8 flex justify-center items-center gap-6">
                  <button onClick={stopCamera} className="w-12 h-12 bg-white/20 backdrop-blur-md text-white rounded-full">✕</button>
                  <button onClick={capturePhoto} className="w-20 h-20 bg-white rounded-full border-[6px] border-blue-600/30 active:scale-90 transition-all" />
                  <button onClick={() => setFacingMode(f => f === 'user' ? 'environment' : 'user')} className="w-12 h-12 bg-white/20 text-white rounded-full flex items-center justify-center"><FlipHorizontal className="w-5 h-5" /></button>
                </div>
              </div>
            )}

            {image && !result && (
              <div className="bg-white dark:bg-slate-900 rounded-[2rem] overflow-hidden shadow-2xl border border-slate-100 dark:border-slate-800 animate-in fade-in zoom-in-95">
                <img src={image} className="w-full aspect-[4/3] object-cover" alt="Capture" />
                <div className="p-6 space-y-4">
                  <button onClick={analyzeLipHealth} disabled={isAnalyzing} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-3">
                    {isAnalyzing ? <RefreshCcw className="animate-spin w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
                    {isAnalyzing ? "Analyzing..." : "Confirm & Analyze"}
                  </button>
                  <button onClick={reset} className="w-full text-slate-400 font-semibold text-sm">Retake Photo</button>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] shadow-xl border border-slate-100 dark:border-slate-800">
                  <h2 className="text-3xl font-black mb-2 text-blue-600">{result.dehydration_status}</h2>
                  <p className="text-slate-600 dark:text-slate-400 mb-8 leading-relaxed italic">"{result.summary}"</p>
                  <div className="grid grid-cols-3 gap-3">
                    {Object.entries(result.metrics).map(([key, value]) => (
                      <div key={key} className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl text-center border border-slate-100 dark:border-slate-700">
                        <div className="text-xl font-black text-blue-600">{value}%</div>
                        <div className="text-[10px] uppercase font-bold text-slate-400 mt-1">{key.replace('_', ' ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={reset} className="w-full py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold hover:bg-slate-50 transition-colors">Start New Analysis</button>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-xs font-mono leading-tight flex items-start gap-3">
                <AlertCircle className="shrink-0 w-4 h-4 mt-0.5" /> 
                <div>
                  <p className="font-bold mb-1 underline uppercase">Developer Log:</p>
                  {error}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-2xl font-black mb-6">Past Scans</h2>
            {loadingHistory ? <RefreshCcw className="animate-spin mx-auto text-slate-300" /> : history.length === 0 ? (
              <div className="text-center py-20 bg-white dark:bg-slate-900 rounded-[2rem] border border-dashed border-slate-200">
                <History className="w-12 h-12 mx-auto mb-4 text-slate-200" />
                <p className="text-slate-400 font-medium">No scan history found.</p>
              </div>
            ) : history.map(item => (
              <div key={item.id} className="bg-white dark:bg-slate-900 p-4 rounded-2xl flex items-center gap-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                <img src={item.thumbnail} className="w-16 h-16 rounded-xl object-cover" alt="Scan" />
                <div className="flex-1">
                  <p className="font-bold">{item.dehydration_status}</p>
                  <p className="text-xs text-slate-400">{item.timestamp?.toDate().toLocaleDateString()}</p>
                </div>
                <button onClick={() => deleteDoc(doc(db, 'users', user.uid, 'lip_history', item.id))} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default App;
