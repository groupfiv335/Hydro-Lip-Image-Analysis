import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Droplets, AlertCircle, CheckCircle2, RefreshCcw, Info, Activity, History, Calendar, Trash2, FlipHorizontal, ArrowRight, ShieldCheck } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, onSnapshot, query, deleteDoc, Timestamp } from 'firebase/firestore';

// --- Configuration & Constants ---
const apiKey = ""; // Gemini API Key provided at runtime
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";

// Firebase Globals
let app, auth, db;
try {
  const firebaseConfig = JSON.parse(__firebase_config);
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase initialization failed:", e);
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'lip-health-v1';

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
  const [step, setStep] = useState(1); // 1: Select, 2: Capture/Preview, 3: Result
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // --- Auth Initialization ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- Firestore Data Fetching ---
  useEffect(() => {
    if (!user || !db) return;

    setLoadingHistory(true);
    const historyRef = collection(db, 'artifacts', appId, 'users', user.uid, 'history');
    
    const unsubscribe = onSnapshot(historyRef, (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      const sorted = items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setHistory(sorted);
      setLoadingHistory(false);
    }, (err) => {
      console.error("Firestore error:", err);
      setLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [user]);

  // --- Fixed Camera Logic ---
  const startCamera = async () => {
    setError(null);
    try {
      stopCamera();
      const constraints = { 
        video: { 
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setIsCameraOpen(true);
      setStep(2);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play().catch(e => console.error("Video play failed:", e));
          };
        }
      }, 100);
      
    } catch (err) {
      console.error("Camera Error:", err);
      setError("Unable to access camera. Please ensure you have granted permission.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
  };

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  useEffect(() => {
    if (isCameraOpen) {
      startCamera();
    }
  }, [facingMode]);

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
      const dataUrl = canvas.toDataURL('image/png');
      setImage(dataUrl);
      setStep(2);
      stopCamera();
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target.result);
        setStep(2);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeLipHealth = async () => {
    if (!image || !user) return;
    setIsAnalyzing(true);
    setError(null);

    const base64Data = image.split(',')[1];
    const systemPrompt = `You are a specialized dermatological assistant focused on lip health and hydration analysis. 
    Analyze the provided image specifically for lip health markers.
    Provide a structured JSON response with the following keys:
    1. dehydration_status: (String: 'Hydrated', 'Mildly Dehydrated', 'Severely Dehydrated')
    2. metrics: { crack_intensity: (0-100), dryness_level: (0-100), moisture_score: (0-100), color_description: (String) }
    3. visual_observations: (List of strings)
    4. recommendations: (List of strings)
    5. summary: (String)
    Be medically accurate and objective. Use percentages for metrics.`;

    const payload = {
      contents: [{
        parts: [
          { text: "Analyze the lip health in this image and provide a detailed report." },
          { inlineData: { mimeType: "image/png", data: base64Data } }
        ]
      }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { responseMimeType: "application/json" }
    };

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error('AI Analysis failed');
      const data = await response.json();
      const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text);
      setResult(parsed);
      setStep(3);

      if (db) {
        const historyRef = collection(db, 'artifacts', appId, 'users', user.uid, 'history');
        await addDoc(historyRef, {
          ...parsed,
          timestamp: Timestamp.now(),
          thumbnail: image 
        });
      }
    } catch (err) {
      setError("Analysis failed. Please try again with a clearer photo.");
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const deleteRecord = async (id) => {
    if (!user || !db) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'history', id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const reset = () => {
    setImage(null);
    setResult(null);
    setError(null);
    setStep(1);
    stopCamera();
  };

  const StepIndicator = ({ currentStep }) => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3].map((s) => (
        <React.Fragment key={s}>
          <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all duration-300 ${
            currentStep === s 
              ? 'bg-blue-600 border-blue-600 text-white font-bold scale-110' 
              : currentStep > s 
              ? 'bg-emerald-500 border-emerald-500 text-white' 
              : 'border-slate-300 dark:border-slate-700 text-slate-400'
          }`}>
            {currentStep > s ? <CheckCircle2 className="w-5 h-5" /> : s}
          </div>
          {s < 3 && <div className={`w-8 h-0.5 ${currentStep > s ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'}`} />}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-24">
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-500/20">
              <Droplets className="text-white w-5 h-5" />
            </div>
            <h1 className="font-extrabold text-xl tracking-tight">LipHydrate <span className="text-blue-600">AI</span></h1>
          </div>
          <button 
            onClick={() => setActiveTab(activeTab === 'analyze' ? 'history' : 'analyze')}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors relative"
          >
            {activeTab === 'analyze' ? <History className="w-6 h-6" /> : <Camera className="w-6 h-6" />}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-6">
        {activeTab === 'analyze' ? (
          <div className="max-w-2xl mx-auto space-y-6">
            <StepIndicator currentStep={step} />

            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 md:p-12 shadow-xl border border-slate-100 dark:border-slate-800 text-center space-y-8">
                  <div className="space-y-4">
                    <h2 className="text-3xl font-black text-slate-800 dark:text-white leading-tight">Start Your Analysis</h2>
                    <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                      Step 1: Provide a clear photo of your lips under good lighting.
                    </p>
                  </div>

                  <div className="flex flex-col gap-4 max-w-xs mx-auto">
                    <button onClick={startCamera} className="group relative flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-2xl transition-all active:scale-95 shadow-xl shadow-blue-600/20">
                      <Camera className="w-5 h-5" />
                      Open Camera
                    </button>
                    <label className="flex items-center justify-center gap-3 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 hover:border-blue-400 text-slate-700 dark:text-slate-200 font-bold py-4 px-6 rounded-2xl cursor-pointer transition-all active:scale-95">
                      <Upload className="w-5 h-5" />
                      Upload File
                      <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                    </label>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/10 rounded-2xl p-6 border border-blue-100 dark:border-blue-900/30">
                  <h4 className="font-bold flex items-center gap-2 text-blue-800 dark:text-blue-300 mb-4">
                    <Info className="w-4 h-4" /> Best results guide:
                  </h4>
                  <ul className="space-y-3">
                    <li className="flex gap-3 text-sm text-blue-700 dark:text-blue-400">
                      <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0 font-bold text-[10px]">1</div>
                      Use bright, natural daylight for the photo.
                    </li>
                    <li className="flex gap-3 text-sm text-blue-700 dark:text-blue-400">
                      <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0 font-bold text-[10px]">2</div>
                      Ensure lips are centered and clearly in focus.
                    </li>
                    <li className="flex gap-3 text-sm text-blue-700 dark:text-blue-400">
                      <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0 font-bold text-[10px]">3</div>
                      Remove any lipstick or lip balm before scanning.
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {isCameraOpen && (
              <div className="relative rounded-3xl overflow-hidden bg-black aspect-[3/4] shadow-2xl animate-in zoom-in-95 duration-500">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`} 
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="w-64 h-32 border-2 border-white/50 rounded-full flex items-center justify-center" />
                  <p className="mt-4 text-white font-bold text-sm bg-black/40 px-4 py-1 rounded-full backdrop-blur-md">Center your lips here</p>
                </div>
                <div className="absolute bottom-8 left-0 right-0 flex justify-center items-center gap-8 px-8">
                  <button onClick={stopCamera} className="w-12 h-12 bg-black/40 backdrop-blur-md text-white rounded-full flex items-center justify-center hover:bg-black/60 transition-all">✕</button>
                  <button onClick={capturePhoto} className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all border-8 border-white/20">
                    <div className="w-14 h-14 rounded-full border-2 border-slate-900" />
                  </button>
                  <button onClick={toggleCamera} className="w-12 h-12 bg-black/40 backdrop-blur-md text-white rounded-full flex items-center justify-center hover:bg-black/60 transition-all">
                    <FlipHorizontal className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {image && !result && (
              <div className="bg-white dark:bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-100 dark:border-slate-800 animate-in slide-in-from-bottom-8 duration-500">
                <div className="p-4 bg-slate-50 dark:bg-slate-800 flex justify-between items-center">
                  <h3 className="font-bold text-sm">Step 2: Confirm & Analyze</h3>
                  <button onClick={reset} className="text-xs text-blue-600 font-bold hover:underline">Restart</button>
                </div>
                <div className="relative aspect-[4/3] bg-black">
                  <img src={image} alt="Preview" className="w-full h-full object-contain" />
                </div>
                <div className="p-6 md:p-8 space-y-6">
                  <div className="flex flex-col gap-3">
                    <button 
                      disabled={isAnalyzing}
                      onClick={analyzeLipHealth}
                      className="w-full py-4 px-6 rounded-2xl bg-blue-600 text-white font-black hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg shadow-blue-500/30 transition-all"
                    >
                      {isAnalyzing ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                      {isAnalyzing ? "Processing AI Analysis..." : "Analyze Now"}
                    </button>
                    <button onClick={reset} className="w-full py-3 text-slate-500 font-bold hover:text-slate-700 transition-colors">
                      Take a different photo
                    </button>
                  </div>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden">
                   <div className={`absolute top-0 right-0 w-48 h-48 blur-3xl opacity-20 rounded-full -mr-24 -mt-24 ${result.dehydration_status === 'Hydrated' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  
                  <div className="flex items-center gap-4 mb-6 relative z-10">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${result.dehydration_status === 'Hydrated' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                      {result.dehydration_status === 'Hydrated' ? <CheckCircle2 className="w-7 h-7" /> : <AlertCircle className="w-7 h-7" />}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Final Step: Report</p>
                      <h3 className="text-2xl font-black">{result.dehydration_status}</h3>
                    </div>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed relative z-10 italic">
                    "{result.summary}"
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-100 dark:border-slate-800">
                    <h4 className="font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-600" /> Metrics Breakdown
                    </h4>
                    {[
                      { label: "Crack Intensity", val: result.metrics.crack_intensity, color: "bg-rose-500" },
                      { label: "Dryness Level", val: result.metrics.dryness_level, color: "bg-orange-400" },
                      { label: "Moisture Score", val: result.metrics.moisture_score, color: "bg-cyan-500" }
                    ].map((m) => (
                      <div key={m.label} className="mb-4">
                        <div className="flex justify-between mb-1">
                          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{m.label}</span>
                          <span className="text-sm font-bold">{m.val}%</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-full ${m.color}`} style={{ width: `${m.val}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-2xl">
                    <h4 className="font-bold mb-6 flex items-center gap-2 text-blue-400">
                      <Info className="w-4 h-4" /> Recommended Care
                    </h4>
                    <div className="space-y-4">
                      {result.recommendations.map((rec, i) => (
                        <div key={i} className="flex gap-3">
                          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-[10px] font-bold text-blue-300">
                            {i + 1}
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed">{rec}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <button onClick={reset} className="w-full py-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-sm">
                  <RefreshCcw className="w-4 h-4" /> Start New Session
                </button>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-2xl flex items-center gap-3 text-red-600">
                <AlertCircle className="shrink-0" />
                <p className="text-sm font-bold">{error}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            <header className="mb-8">
              <h2 className="text-3xl font-black">Hydration History</h2>
              <p className="text-slate-500">Track your skin's improvement progress</p>
            </header>

            {loadingHistory ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <RefreshCcw className="w-10 h-10 animate-spin text-blue-600" />
                <p className="font-bold text-slate-400 uppercase tracking-widest text-xs">Syncing Data</p>
              </div>
            ) : history.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-16 border-2 border-dashed border-slate-200 dark:border-slate-800 text-center">
                <History className="w-12 h-12 text-slate-200 dark:text-slate-800 mx-auto mb-4" />
                <h3 className="text-xl font-bold mb-2">No History Yet</h3>
                <button onClick={() => setActiveTab('analyze')} className="mt-4 bg-blue-600 text-white font-bold py-3 px-8 rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95">
                  Take Your First Scan
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {history.map((record) => (
                  <div key={record.id} className="bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col transition-all hover:shadow-md">
                    <div className="relative h-44 overflow-hidden bg-slate-100 dark:bg-slate-800">
                      <img src={record.thumbnail} className="w-full h-full object-cover" alt="Past Scan" />
                      <div className="absolute top-2 right-2">
                        <button onClick={() => deleteRecord(record.id)} className="p-2 bg-black/40 backdrop-blur-md text-white rounded-lg hover:bg-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="absolute bottom-2 left-2 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full text-white text-[10px] font-bold flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {record.timestamp?.toDate().toLocaleDateString()}
                      </div>
                    </div>
                    <div className="p-5 flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${record.dehydration_status === 'Hydrated' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                          {record.dehydration_status}
                        </span>
                        <span className="text-xs font-bold text-blue-600">{record.metrics.moisture_score}%</span>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2 italic leading-relaxed">"{record.summary}"</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-t border-slate-200 dark:border-slate-800 p-4 z-40 md:hidden">
        <div className="max-w-md mx-auto flex justify-around items-center">
          <button 
            onClick={() => setActiveTab('analyze')} 
            className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'analyze' ? 'text-blue-600' : 'text-slate-400'}`}
          >
            <Camera className="w-6 h-6" />
            <span className="text-[10px] font-black uppercase">Scan</span>
          </button>
          <button 
            onClick={() => setActiveTab('history')} 
            className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'history' ? 'text-blue-600' : 'text-slate-400'}`}
          >
            <History className="w-6 h-6" />
            <span className="text-[10px] font-black uppercase">History</span>
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default App;