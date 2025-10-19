import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, collection, query, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let app, db, auth;
let userId = null;
let scene, camera, renderer, particles, dna, orb;
let mouseX = 0, mouseY = 0;
let audioPlayer = null; // To manage the currently playing audio

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyCJYyqeCGlsUreOFyR4LXrlZDKublc15Ik",
  authDomain: "arogya-copilot.firebaseapp.com",
  projectId: "arogya-copilot",
  storageBucket: "arogya-copilot.firebasestorage.app",
  messagingSenderId: "743739908215",
  appId: "1:743739908215:web:08aa603e2627d0f0dd2672"
};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

const state = {
    selectedLanguage: 'en-US', isRecording: false, isLoggedIn: false, firestoreReady: false,
    uploadedFiles: [], moduleHistory: {}, isTTSEnabled: true, isSidebarOpen: false, activeModule: null
};

const getEl = id => document.getElementById(id);
const welcomeAuthModal = getEl('welcome-auth-modal'), appWrapper = getEl('app-wrapper'),
      chatWindow = getEl('chat-window'), chatInput = getEl('chat-input'),
      mainModuleContent = getEl('main-module-content'), arogyaAssistantPanel = getEl('arogya-assistant-panel'),
      arogyaAssistantToggle = getEl('arogya-assistant-toggle');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) { recognition.continuous = false; recognition.interimResults = false; }

// --- TTS Helper Functions (API-based) ---
const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); }
    return bytes.buffer;
};

const pcmToWav = (pcmData, sampleRate) => {
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit PCM
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // RIFF chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + pcmData.byteLength, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Sub-chunk size
    view.setUint16(20, 1, true); // Audio format (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // Byte rate
    view.setUint16(32, numChannels * bytesPerSample, true); // Block align
    view.setUint16(34, bytesPerSample * 8, true); // Bits per sample
    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, pcmData.byteLength, true);
    
    return new Blob([wavHeader, pcmData], { type: 'audio/wav' });
};

const VOICE_CONFIG = {
    'en-US': { voiceName: 'Zephyr' },
    'hi-IN': { voiceName: 'Kore' },
    'bn-IN': { voiceName: 'Puck' },
    'te-IN': { voiceName: 'Leda' },
    'mr-IN': { voiceName: 'Charon' },
    'ta-IN': { voiceName: 'Fenrir' },
    'gu-IN': { voiceName: 'Aoede' },
    'kn-IN': { voiceName: 'Orus' },
    'ml-IN': { voiceName: 'Sadachbia' },
    'pa-IN': { voiceName: 'Callirrhoe' }
};

const speak = async (text, btn) => {
    const isLoading = btn && btn.classList.contains('loading-speech');
    const isSpeaking = btn && btn.classList.contains('speaking');
    
    // Stop any currently playing audio
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = '';
        audioPlayer = null;
    }
    // Reset all other buttons
    document.querySelectorAll('.speak-btn.speaking, .speak-btn.loading-speech').forEach(b => {
        b.classList.remove('speaking', 'loading-speech');
    });

    // If the clicked button was already active, the above code stops it. So we just return.
    if (isLoading || isSpeaking) {
        return;
    }

    if (!text || !btn) return;

    btn.classList.add('loading-speech'); // Show loader immediately
    
    const langConfig = VOICE_CONFIG[state.selectedLanguage];
    if (!langConfig) {
        console.error(`No voice configuration found for language: ${state.selectedLanguage}`);
        if (btn) btn.classList.remove('loading-speech');
        return;
    }

    const apiKey = "AIzaSyCbPOQM8vN7pou3lupqEd-1MfTFGnA61UM";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ parts: [{ text }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: langConfig } }
        }
    };
    
    try {
        const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        const part = result?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType;

        if (audioData && mimeType?.startsWith("audio/")) {
            const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
            const pcmData = base64ToArrayBuffer(audioData);
            const wavBlob = pcmToWav(new Int16Array(pcmData), sampleRate);
            const audioUrl = URL.createObjectURL(wavBlob);
            
            btn.classList.remove('loading-speech');
            btn.classList.add('speaking');
            
            audioPlayer = new Audio(audioUrl);
            audioPlayer.play().catch(e => {
                console.error("Audio play failed:", e);
                if(btn) btn.classList.remove('speaking');
            });

            audioPlayer.onended = () => {
                if (btn) btn.classList.remove('speaking');
                audioPlayer = null;
                URL.revokeObjectURL(audioUrl); // Clean up memory
            };
            audioPlayer.onerror = () => {
                console.error("Audio playback error.");
                if (btn) btn.classList.remove('speaking');
                audioPlayer = null;
                URL.revokeObjectURL(audioUrl);
            };
        } else {
            throw new Error("No audio data received from API.");
        }
    } catch (error) {
        console.error("TTS API Error:", error);
        if (btn) btn.classList.remove('loading-speech'); // Clean up on error
    }
};

const translations = {
    'en-US': {
        welcome_subtitle: 'Your AI Health Ecosystem for Bharat.', select_language_label: 'Select your preferred language:', email_placeholder: 'Email Address', password_placeholder: 'Password', login_button: 'Login', signup_button: 'Sign Up', or_divider: 'OR', anonymous_button: 'Continue Anonymously', proceed_button: 'Proceed to App', health_modules_title: 'Health Modules', logout_button: 'Logout', ask_arogya_placeholder: 'Ask Arogya...', welcome_placeholder_title: 'Welcome to Arogya', welcome_placeholder_subtitle: 'Select a module from the left to begin your health journey.', auth_success_login: 'Login successful! Entering...', auth_success_signup: 'Sign up successful! Welcome.', auth_fail: msg => `Operation failed: ${msg}`, auth_enter_details: 'Please enter both email and password.', greeting: 'Hello! I am Arogya Co-Pilot. How can I assist you today?', file_read_error: 'Error: Could not read the uploaded file.', drop_invalid_file: type => `Please drop a valid ${type} file.`, upload_invalid_file: type => `Error: Please upload a valid ${type} file.`, analysis_loading: 'AI is analyzing your input... This may take a moment.', analysis_error: 'An error occurred during AI analysis. Please try again.', upload_first: 'Please upload at least one report image first.', upload_audio_first: 'Please upload an audio file first.',
        module_future_title: 'Arogya-Future',
        module_future_desc: 'Predictive Health Forecaster',
        module_wellness_title: 'AI Wellness Planner',
        module_wellness_desc: 'Dynamic AI Health Plans',
        module_healthtrend_title: 'Health-Trend AI',
        module_healthtrend_desc: 'Medical Report Analyzer',
        module_medsentry_title: 'Med-Sentry AI',
        module_medsentry_desc: 'Drug Interaction Checker',
        module_arogyasos_title: 'Arogya-SOS',
        module_arogyasos_desc: 'AI Emergency Response',
        module_sonus_title: 'Sonus AI',
        module_sonus_desc: 'Acoustic Diagnostic System',
        module_vocaltone_title: 'Vocal-Tone AI',
        module_vocaltone_desc: 'Vocal Biomarker Analysis',
        module_derma_title: 'Dermalens',
        module_derma_desc: 'AI Skin Health Analyzer',
        module_mycro_title: 'Mycro',
        module_mycro_desc: 'Gut Microbiome Simulator',
        module_cogni_title: 'Cogni-Pulse',
        module_cogni_desc: 'Cognitive Decline Detection',
        module_ayur_title: 'Ayurveda AI',
        module_ayur_desc: 'Medicinal Plant Identifier',
        module_gait_title: 'Gait-Guard',
        module_gait_desc: 'AI Posture & Gait Analysis',
        module_ehr_title: 'EHR-Summarizer',
        module_ehr_desc: 'Health Record Interpreter',
        module_mindwell_title: 'MindWell',
        module_mindwell_desc: 'Empathetic Mental Companion',
        module_visionfit_title: 'Vision-Fit',
        module_visionfit_desc: 'AI-Powered Physiotherapist',
        module_govschemes_title: 'Govt. Health Schemes',
        module_govschemes_desc: 'Find relevant schemes near you',
        module_genopredict_title: 'Geno-Predict AI',
        module_genopredict_desc: 'Genetic Marker Analysis',
        module_hospitalconnect_title: 'Hospital Connect',
        module_hospitalconnect_desc: 'Streamline Hospital Operations & Patient Care',
        module_aiscribe_title: 'AI-Scribe',
        module_aiscribe_desc: 'Voice-to-Clinical Notes',
        module_digitaltwin_title: 'Digital Twin Simulator',
        module_digitaltwin_desc: 'Simulate Lifestyle Changes',
        module_outbreak_title: 'Outbreak Predictor',
        module_outbreak_desc: 'AI-Powered Epidemic Forecasting'
    },
    'hi-IN': {
        welcome_subtitle: 'भारत के लिए आपका एआई स्वास्थ्य पारिस्थितिकी तंत्र।', select_language_label: 'अपनी पसंदीदा भाषा चुनें:', email_placeholder: 'ईमेल पता', password_placeholder: 'पासवर्ड', login_button: 'लॉग इन करें', signup_button: 'साइन अप करें', or_divider: 'या', anonymous_button: 'गुमनाम रूप से जारी रखें', proceed_button: 'ऐप पर जाएं', health_modules_title: 'स्वास्थ्य मॉड्यूल', logout_button: 'लॉग आउट', ask_arogya_placeholder: 'आरोग्य से पूछें...', welcome_placeholder_title: 'आरोग्य में आपका स्वागत है', welcome_placeholder_subtitle: 'अपनी स्वास्थ्य यात्रा शुरू करने के लिए बाईं ओर से एक मॉड्यूल चुनें।', auth_success_login: 'लॉगिन सफल! प्रवेश कर रहे हैं...', auth_success_signup: 'साइन अप सफल! स्वागत है।', auth_fail: msg => `कार्रवाई विफल: ${msg}`, auth_enter_details: 'कृपया ईमेल और पासवर्ड दोनों दर्ज करें।', greeting: 'नमस्ते! मैं आरोग्य को-पायलट हूँ। मैं आज आपकी कैसे सहायता कर सकता हूँ?', file_read_error: 'त्रुटि: अपलोड की गई फ़ाइल को पढ़ा नहीं जा सका।', drop_invalid_file: type => `कृपया एक मान्य ${type} फ़ाइल डालें।`, upload_invalid_file: type => `त्रुटि: कृपया एक मान्य ${type} फ़ाइल अपलोड करें।`, analysis_loading: 'एआई आपके इनपुट का विश्लेषण कर रहा है... इसमें कुछ समय लग सकता है।', analysis_error: 'एआई विश्लेषण के दौरान एक त्रुटि हुई। कृपया पुन: प्रयास करें।', upload_first: 'कृपया पहले कम से कम एक रिपोर्ट छवि अपलोड करें।', upload_audio_first: 'कृपया पहले एक ऑडियो फ़ाइल अपलोड करें।',
        module_future_title: 'आरोग्य-भविष्य', module_future_desc: 'भविष्य कहनेवाला स्वास्थ्य भविष्यवक्ता',
        module_wellness_title: 'एआई वेलनेस प्लानर', module_wellness_desc: 'गतिशील एआई स्वास्थ्य योजना',
        module_healthtrend_title: 'हेल्थ-ट्रेंड एआई', module_healthtrend_desc: 'मेडिकल रिपोर्ट विश्लेषक',
        module_medsentry_title: 'मेड-सेंट्री एआई', module_medsentry_desc: 'दवा बातचीत परीक्षक',
        module_arogyasos_title: 'आरोग्य-एसओएस', module_arogyasos_desc: 'एआई आपातकालीन प्रतिक्रिया',
        module_sonus_title: 'सोनस एआई', module_sonus_desc: 'ध्वनिक नैदानिक प्रणाली',
        module_vocaltone_title: 'वोकल-टोन एआई', module_vocaltone_desc: 'मुखर बायोमार्कर विश्लेषण',
        module_derma_title: 'डर्मलेंस', module_derma_desc: 'एआई त्वचा स्वास्थ्य विश्लेषक',
        module_mycro_title: 'माइक्रो', module_mycro_desc: 'आंत माइक्रोबायोम सिम्युलेटर',
        module_cogni_title: 'कॉग्नि-पल्स', module_cogni_desc: 'संज्ञानात्मक गिरावट का पता लगाना',
        module_ayur_title: 'आयुर्वेद एआई', module_ayur_desc: 'औषधीय पौधे की पहचान करने वाला',
        module_gait_title: 'गेट-गार्ड', module_gait_desc: 'एआई आसन और चाल विश्लेषण',
        module_ehr_title: 'ईएचआर-समराइज़र', module_ehr_desc: 'स्वास्थ्य रिकॉर्ड दुभाषिया',
        module_mindwell_title: 'माइंडवेल', module_mindwell_desc: 'सहानुभूतिपूर्ण मानसिक साथी',
        module_visionfit_title: 'विजन-फिट', module_visionfit_desc: 'एआई-संचालित फिजियोथेरेपिस्ट',
        module_govschemes_title: 'सरकारी स्वास्थ्य योजनाएं', module_govschemes_desc: 'अपने आस-पास प्रासंगिक योजनाएं खोजें',
        module_genopredict_title: 'जीनो-प्रेडिक्ट एआई', module_genopredict_desc: 'आनुवंशिक मार्कर विश्लेषण',
        module_hospitalconnect_title: 'हॉस्पिटल कनेक्ट',
        module_hospitalconnect_desc: 'अस्पताल संचालन और रोगी देखभाल को सुव्यवस्थित करें',
        module_aiscribe_title: 'एआई-स्क्राइब',
        module_aiscribe_desc: 'आवाज से क्लिनिकल नोट्स',
        module_digitaltwin_title: 'डिजिटल ट्विन सिम्युलेटर',
        module_digitaltwin_desc: 'जीवनशैली परिवर्तनों का अनुकरण करें',
        module_outbreak_title: 'प्रकोप भविष्यवक्ता',
        module_outbreak_desc: 'एआई-संचालित महामारी पूर्वानुमान'
    },
    'bn-IN': { welcome_subtitle: 'ভারতের জন্য আপনার এআই স্বাস্থ্য ইকোসিস্টেম।', select_language_label: 'আপনার পছন্দের ভাষা নির্বাচন করুন:', email_placeholder: 'ইমেল ঠিকানা', password_placeholder: 'পাসওয়ার্ড', login_button: 'লগইন', signup_button: 'সাইন আপ', or_divider: 'অথবা', anonymous_button: 'নামবিহীনভাবে চালিয়ে যান', proceed_button: 'অ্যাপে এগিয়ে যান', health_modules_title: 'স্বাস্থ্য মডিউল', logout_button: 'লগআউট', ask_arogya_placeholder: 'আরোগ্যকে জিজ্ঞাসা করুন...', welcome_placeholder_title: 'আরোগ্যে স্বাগতম', welcome_placeholder_subtitle: 'আপনার স্বাস্থ্য যাত্রা শুরু করতে বাম দিক থেকে একটি মডিউল নির্বাচন করুন।', auth_success_login: 'লগইন সফল! প্রবেশ করা হচ্ছে...', auth_success_signup: 'সাইন আপ সফল! স্বাগতম।', auth_fail: msg => `অপারেশন ব্যর্থ হয়েছে: ${msg}`, auth_enter_details: 'অনুগ্রহ করে ইমেল এবং পাসওয়ার্ড উভয়ই লিখুন।', greeting: 'নমস্কার! আমি আরোগ্য কো-পাইলট। আমি আজ আপনাকে কীভাবে সাহায্য করতে পারি?', file_read_error: 'ত্রুটি: আপলোড করা ফাইলটি পড়া যায়নি।', drop_invalid_file: type => `অনুগ্রহ করে একটি বৈধ ${type} ফাইল ড্রপ করুন।`, upload_invalid_file: type => `ত্রুটি: অনুগ্রহ করে একটি বৈধ ${type} ফাইল আপলোড করুন।`, analysis_loading: 'এআই আপনার ইনপুট বিশ্লেষণ করছে... এতে কিছু সময় লাগতে পারে।', analysis_error: 'এআই বিশ্লেষণের সময় একটি ত্রুটি ঘটেছে। অনুগ্রহ করে আবার চেষ্টা করুন।', upload_first: 'অনুগ্রহ করে প্রথমে অন্তত একটি রিপোর্ট চিত্র আপলোড করুন।', upload_audio_first: 'অনুগ্রহ করে প্রথমে একটি অডিও ফাইল আপলোড করুন।', module_future_title: 'আরোগ্য-ভবিষ্যৎ', module_future_desc: 'ভবিষ্যদ্বাণীমূলক স্বাস্থ্য পূর্বাভাসকারী', module_wellness_title: 'এআই ওয়েলনেস প্ল্যানার', module_wellness_desc: 'ডাইনামিক এআই স্বাস্থ্য পরিকল্পনা', module_healthtrend_title: 'হেলথ-ট্রেন্ড এআই', module_healthtrend_desc: 'মেডিকেল রিপোর্ট বিশ্লেষক', module_medsentry_title: 'মেড-সেন্ট্রি এআই', module_medsentry_desc: 'ড্রাগ ইন্টারঅ্যাকশন পরীক্ষক', module_arogyasos_title: 'আরোগ্য-এসওএস', module_arogyasos_desc: 'এআই জরুরি প্রতিক্রিয়া', module_sonus_title: 'সোনাস এআই', module_sonus_desc: 'অ্যাকোস্টিক ডায়াগনস্টিক সিস্টেম', module_vocaltone_title: 'ভোকাল-টোন এআই', module_vocaltone_desc: 'ভোকাল বায়োমার্কার বিশ্লেষণ', module_derma_title: 'ডার্মালেন্স', module_derma_desc: 'এআই স্কিন হেলথ অ্যানালাইজার', module_mycro_title: 'মাইক্রো', module_mycro_desc: 'গাট মাইক্রোবায়োম সিমুলেটর', module_cogni_title: 'কগনি-পালস', module_cogni_desc: 'জ্ঞানীয় পতন সনাক্তকরণ', module_ayur_title: 'আয়ুর্বেদ এআই', module_ayur_desc: 'ঔষধি উদ্ভিদ শনাক্তকারী', module_gait_title: 'গেইট-গার্ড', module_gait_desc: 'এআই ভঙ্গি এবং চাল বিশ্লেষণ', module_ehr_title: 'ইএইচআর-সামারাইজার', module_ehr_desc: 'স্বাস্থ্য রেকর্ড দোভাষী', module_mindwell_title: 'মাইন্ডওয়েল', module_mindwell_desc: ' সহানুভূতিশীল মানসিক সঙ্গী', module_visionfit_title: 'ভিশন-ফিট', module_visionfit_desc: 'এআই-চালিত ফিজিওথেরাপিস্ট', module_govschemes_title: 'সরকারি স্বাস্থ্য প্রকল্প', module_govschemes_desc: 'আপনার কাছাকাছি প্রাসঙ্গিক স্কিম খুঁজুন', module_genopredict_title: 'জেনো-প্রেডিক্ট এআই', module_genopredict_desc: 'জেনেটিক মার্কার বিশ্লেষণ',
        module_hospitalconnect_title: 'হসপিটাল কানেক্ট',
        module_hospitalconnect_desc: 'হাসপাতালের কার্যক্রম এবং রোগীর যত্ন সুবিন্যস্ত করুন',
        module_aiscribe_title: 'এআই-স্ক্রাইব',
        module_aiscribe_desc: 'ভয়েস-টু-ক্লিনিকাল নোট',
        module_digitaltwin_title: 'ডিজিটাল টুইন সিমুলেটর',
        module_digitaltwin_desc: 'জীবনযাত্রার পরিবর্তনগুলি অনুকরণ করুন',
        module_outbreak_title: 'প্রাদুর্ভাব পূর্বাভাসকারী',
        module_outbreak_desc: 'এআই-চালিত মহামারী পূর্বাভাস'
    },
    'te-IN':{ welcome_subtitle: 'భారతదేశం కోసం మీ AI ఆరోగ్య పర్యావరణ వ్యవస్థ.', select_language_label: 'మీకు ఇష్టమైన భాషను ఎంచుకోండి:', email_placeholder: 'ఇమెయిల్ చిరునామా', password_placeholder: 'పాస్వర్డ్', login_button: 'లాగిన్', signup_button: 'సైన్ అప్ చేయండి', or_divider: 'లేదా', anonymous_button: 'అజ్ఞాతంగా కొనసాగండి', proceed_button: 'యాప్కి వెళ్లండి', health_modules_title: 'ఆరోగ్య మాడ్యూల్స్', logout_button: 'లాగ్అవుట్', ask_arogya_placeholder: 'ఆరోగ్యను అడగండి...', welcome_placeholder_title: 'ఆరోగ్యకు స్వాగతం', welcome_placeholder_subtitle: 'మీ ఆరోగ్య ప్రయాణాన్ని ప్రారంభించడానికి ఎడమ నుండి ఒక మాడ్యూల్ని ఎంచుకోండి।', auth_success_login: 'లాగిన్ విజయవంతమైంది! ప్రవేశిస్తోంది...', auth_success_signup: 'సైన్ అప్ విజయవంతమైంది! స్వాగతం.', auth_fail: msg => `ఆపరేషన్ విఫలమైంది: ${msg}`, auth_enter_details: 'దయచేసి ఇమెయిల్ మరియు పాస్వర్డ్ రెండింటినీ నమోదు చేయండి।', greeting: 'నమస్కారం! నేను ఆరోగ్య కో-పైలట్. ఈ రోజు నేను మీకు ఎలా సహాయపడగలను?', file_read_error: 'లోపం: అప్లోడ్ చేసిన ఫైల్ను చదవలేకపోయాము।', drop_invalid_file: type => `దయచేసి చెల్లుబాటు అయ్యే ${type} ఫైల్ను డ్రాప్ చేయండి।`, upload_invalid_file: type => `లోపం: దయచేసి చెల్లుబాటు అయ్యే ${type} ఫైల్ను అప్లోడ్ చేయండి।`, analysis_loading: 'AI మీ ఇన్పుట్ను విశ్లేషిస్తోంది... దీనికి కొంత సమయం పట్టవచ్చు।', analysis_error: 'AI విశ్లేషణ సమయంలో లోపం సంభవించింది। దయచేసి మళ్లీ ప్రయత్నించండి।', upload_first: 'దయచేసి ముందుగా కనీసం ఒక నివేదిక చిత్రాన్ని అప్లోడ్ చేయండి।', upload_audio_first: 'దయచేసి ముందుగా ఒక ఆడియో ఫైల్ను అప్లోడ్ చేయండి।', module_future_title: 'ఆరోగ్య-భవిష్యత్తు', module_future_desc: 'భవిష్య సూచక ఆరోగ్య సూచిక', module_wellness_title: 'AI వెల్నెస్ ప్లానర్', module_wellness_desc: 'డైనమిక్ AI ఆరోగ్య ప్రణాళికలు', module_healthtrend_title: 'హెల్త్-ట్రెండ్ AI', module_healthtrend_desc: 'వైద్య నివేదిక విశ్లేషకం', module_medsentry_title: 'మెడ్-సెంట్రీ AI', module_medsentry_desc: 'డ్రగ్ ఇంటరాక్షన్ చెకర్', module_arogyasos_title: 'ఆరోగ్య-SOS', module_arogyasos_desc: 'AI అత్యవసర ప్రతిస్పందన', module_sonus_title: 'సోనస్ AI', module_sonus_desc: 'అకౌస్టిక్ డయాగ్నస్టిక్ సిస్టమ్', module_vocaltone_title: 'వోకల్-టోన్ AI', module_vocaltone_desc: 'వోకల్ బయోమార్కర్ విశ్లేషణ', module_derma_title: 'డెర్మాలెన్స్', module_derma_desc: 'AI చర్మ ఆరోగ్య విశ్లేషకం', module_mycro_title: 'మైక్రో', module_mycro_desc: 'పేగు మైక్రోబయోమ్ సిమ్యులేటర్', module_cogni_title: 'కాగ్ని-పల్స్', module_cogni_desc: 'జ్ఞాన క్షీణత గుర్తింపు', module_ayur_title: 'ఆయుర్వేదం AI', module_ayur_desc: 'ఔషధ మొక్కల గుర్తింపు', module_gait_title: 'గేట్-గార్డ్', module_gait_desc: 'AI భంగిమ & నడక విశ్లేషణ', module_ehr_title: 'EHR-సారాంశం', module_ehr_desc: 'ఆరోగ్య రికార్డ్ వ్యాఖ్యాత', module_mindwell_title: 'మైండ్వెల్', module_mindwell_desc: 'సానుభూతిగల మానసిక సహచరుడు', module_visionfit_title: 'విజన్-ఫిట్', module_visionfit_desc: 'AI- ఆధారిత ఫిజియోథెరపిస్ట్', module_govschemes_title: 'ప్రభుత్వ ఆరోగ్య పథకాలు', module_govschemes_desc: 'మీ దగ్గర సంబంధిత పథకాలను కనుగొనండి', module_genopredict_title: 'జెనో-ప్రిడిక్ట్ AI', module_genopredict_desc: 'జన్యు మార్కర్ విశ్లేషణ',
        module_hospitalconnect_title: 'హాస్పిటల్ కనెక్ట్',
        module_hospitalconnect_desc: 'హాస్పిటల్ కార్యకలాపాలు మరియు రోగి సంరక్షణను క్రమబద్ధీకరించండి',
        module_aiscribe_title: 'AI-స్క్రైబ్',
        module_aiscribe_desc: 'వాయిస్-టు-క్లినికల్ నోట్స్',
        module_digitaltwin_title: 'డిజిటల్ ట్విన్ సిమ్యులేటర్',
        module_digitaltwin_desc: 'జీవనశైలి మార్పులను అనుకరించండి',
        module_outbreak_title: 'వ్యాప్తి సూచిక',
        module_outbreak_desc: 'AI-ఆధారిత మహమ్మారి అంచనా'
    },
    'mr-IN':{ welcome_subtitle: 'भारतासाठी तुमची AI आरोग्य परिसंस्था.', select_language_label: 'तुमची पसंतीची भाषा निवडा:', email_placeholder: 'ईमेल पत्ता', password_placeholder: 'पासवर्ड', login_button: 'लॉगिन', signup_button: 'साइन अप', or_divider: 'किंवा', anonymous_button: 'अनामिकपणे सुरू ठेवा', proceed_button: 'अॅपवर जा', health_modules_title: 'आरोग्य मॉड्यूल्स', logout_button: 'लॉगआउट', ask_arogya_placeholder: 'आरोग्याला विचारा...', welcome_placeholder_title: 'आरोग्यामध्ये आपले स्वागत आहे', welcome_placeholder_subtitle: 'तुमचा आरोग्य प्रवास सुरू करण्यासाठी डावीकडून एक मॉड्यूल निवडा।', auth_success_login: 'लॉगिन यशस्वी! प्रवेश करत आहे...', auth_success_signup: 'साइन अप यशस्वी! स्वागत आहे.', auth_fail: msg => `ऑपरेशन अयशस्वी: ${msg}`, auth_enter_details: 'कृपया ईमेल आणि पासवर्ड दोन्ही प्रविष्ट करा।', greeting: 'नमस्कार! मी आरोग्य को-पायलट आहे. मी आज तुम्हाला कशी मदत करू शकेन?', file_read_error: 'त्रुटी: अपलोड केलेली फाइल वाचता आली नाही।', drop_invalid_file: type => `कृपया एक वैध ${type} फाइल टाका।`, upload_invalid_file: type => `त्रुटী: कृपया एक वैध ${type} फाइल अपलोड करा।`, analysis_loading: 'AI तुमच्या इनपुटचे विश्लेषण करत आहे... यास थोडा वेळ लागू शकतो।', analysis_error: 'AI विश्लेषणादरम्यान एक त्रुटी आली. कृपया पुन्हा प्रयत्न करा।', upload_first: 'कृपया प्रथम किमान एक अहवाल प्रतिमा अपलोड करा।', upload_audio_first: 'कृपया प्रथम ऑडिओ फाइल अपलोड करा.', module_future_title: 'आरोग्य-भविष्य', module_future_desc: 'भविष्यसूचक आरोग्य આગાહીकर्ता', module_wellness_title: 'एआय वेलनेस प्लॅNER', module_wellness_desc: 'डायनॅमिक एआय आरोग्य योजना', module_healthtrend_title: 'हेल्थ-ट्रेंड एआय', module_healthtrend_desc: 'वैद्यकीय अहवाल विश्लेषक', module_medsentry_title: 'मेड-सेंट्री एआय', module_medsentry_desc: 'औषध संवाद तपासक', module_arogyasos_title: 'आरोग्य-एसओएस', module_arogyasos_desc: 'एआय आपत्कालीन प्रतिसाद', module_sonus_title: 'सोनस एआय', module_sonus_desc: 'ध्वनिक निदान प्रणाली', module_vocaltone_title: 'व्होकल-टोन एआय', module_vocaltone_desc: 'व्होकल बायोमार्कर विश्लेषण', module_derma_title: 'डर्मालेन्स', module_derma_desc: 'एआय त्वचा आरोग्य विश्लेषक', module_mycro_title: 'मायक्रो', module_mycro_desc: 'आतडे मायक्रोबायोम सिम्युलेटर', module_cogni_title: 'कॉग्नि-पल्स', module_cogni_desc: 'संज्ञानात्मक घट ओळख', module_ayur_title: 'आयुर्वेद एआय', module_ayur_desc: 'औषधी वनस्पती ओळखकर्ता', module_gait_title: 'गेट-गार्ड', module_gait_desc: 'एआय पोश्चर आणि चाल विश्लेषण', module_ehr_title: 'ईएचआर-सारांशक', module_ehr_desc: 'आरोग्य रेकॉर्ड इंटरप्रिटर', module_mindwell_title: 'माइंडवेल', module_mindwell_desc: 'सहानुभूतीशील मानसिक सोबती', module_visionfit_title: 'व्हिजन-फिट', module_visionfit_desc: 'एआय-शक्तीवर चालणारा फिजिओथेरपिस्ट', module_govschemes_title: 'सरकारी आरोग्य योजना', module_govschemes_desc: 'तुमच्या जवळच्या संबंधित योजना शोधा', module_genopredict_title: 'जेनो-प्रेडिक्ट एआय', module_genopredict_desc: 'अनुवांशिक मार्कर विश्लेषण',
        module_hospitalconnect_title: 'हॉस्पिटल कनेक्ट',
        module_hospitalconnect_desc: 'रुग्णालयातील कामकाज आणि रुग्णांची काळजी सुव्यवस्थित करा',
        module_aiscribe_title: 'एआय-स्क्राइब',
        module_aiscribe_desc: 'आवाज-ते-क्लिनिकल नोट्स',
        module_digitaltwin_title: 'डिजिटल ट्विन सिम्युलेटर',
        module_digitaltwin_desc: 'जीवनशैलीतील बदलांचे अनुकरण करा',
        module_outbreak_title: 'साथीचा प्रादुर्भाव भविष्यवाणी',
        module_outbreak_desc: 'एआय-शक्तीवर चालणारी महामारीची भविष्यवाणी'
    },
    'ta-IN':{ welcome_subtitle: 'பாரதத்திற்கான உங்கள் AI சுகாதார சுற்றுச்சூழல் அமைப்பு.', select_language_label: 'உங்களுக்கு விருப்பமான மொழியைத் தேர்ந்தெடுக்கவும்:', email_placeholder: 'மின்னஞ்சல் முகவரி', password_placeholder: 'கடவுச்சொல்', login_button: 'உள்நுழை', signup_button: 'பதிவுபெறுக', or_divider: 'அல்லது', anonymous_button: 'அடையாளமின்றி தொடரவும்', proceed_button: 'பயன்பாட்டிற்குச் செல்லவும்', health_modules_title: 'சுகாதார தொகுதிகள்', logout_button: 'வெளியேறு', ask_arogya_placeholder: 'ஆரோக்யாவிடம் கேளுங்கள்...', welcome_placeholder_title: 'ஆரோக்யாவிற்கு வரவேற்கிறோம்', welcome_placeholder_subtitle: 'உங்கள் சுகாதார பயணத்தைத் தொடங்க இடதுபுறத்தில் இருந்து ஒரு தொகுதியைத் தேர்ந்தெடுக்கவும்।', auth_success_login: 'உள்நுழைவு வெற்றி! நுழைகிறது...', auth_success_signup: 'பதிவு வெற்றி! வரவேற்கிறோம்.', auth_fail: msg => `செயல்பாடு தோல்வியடைந்தது: ${msg}`, auth_enter_details: 'தயவுசெய்து மின்னஞ்சல் மற்றும் கடவுச்சொல் இரண்டையும் உள்ளிடவும்।', greeting: 'வணக்கம்! நான் ஆரோக்யா கோ-பைலட். இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?', file_read_error: 'தவறு: பதிவேற்றப்பட்ட கோப்பைப் படிக்க முடியவில்லை।', drop_invalid_file: type => `தயவுசெய்து சரியான ${type} கோப்பை விடுங்கள்।`, upload_invalid_file: type => `தவறு: தயவுசெய்து சரியான ${type} கோப்பைப் பதிவேற்றவும்।`, analysis_loading: 'AI உங்கள் உள்ளீட்டை பகுப்பாய்வு செய்கிறது... இதற்கு சிறிது நேரம் ஆகலாம்।', analysis_error: 'AI பகுப்பாய்வின் போது ஒரு பிழை ஏற்பட்டது. தயவுசெய்து மீண்டும் முயற்சிக்கவும்।', upload_first: 'தயவுசெய்து முதலில் குறைந்தபட்சம் ஒரு அறிக்கை படத்தைப் பதிவேற்றவும்।', upload_audio_first: 'தயவுசெய்து முதலில் ஒரு ஆடியோ கோப்பை பதிவேற்றவும்.', module_future_title: 'ஆரோக்கிய-எதிர்காலம்', module_future_desc: 'முன்கணிப்பு சுகாதார முன்னறிவிப்பு', module_wellness_title: 'AI ஆரோக்கிய திட்டமிடுபவர்', module_wellness_desc: 'டைனమిక్ AI சுகாதார திட்டங்கள்', module_healthtrend_title: 'சுகாதார-போக்கு AI', module_healthtrend_desc: 'மருத்துவ அறிக்கை பகுப்பாய்வி', module_medsentry_title: 'மெட்-சென்ட்ரி AI', module_medsentry_desc: 'மருந்து தொடர்பு சரிபார்ப்பு', module_arogyasos_title: 'ஆரோக்கிய-எஸ்ஓஎஸ்', module_arogyasos_desc: 'AI அவசரகால பதில்', module_sonus_title: 'சோனஸ் AI', module_sonus_desc: 'ஒலி கண்டறியும் அமைப்பு', module_vocaltone_title: 'குரல்-தொனி AI', module_vocaltone_desc: 'குரல் உயிர் குறிப்பான் பகுப்பாய்வு', module_derma_title: 'டெர்மாலென்ஸ்', module_derma_desc: 'AI தோல் சுகாதார பகுப்பாய்வி', module_mycro_title: 'மைக்ரோ', module_mycro_desc: 'குடல் நுண்ணுயிர் சிமுலேட்டர்', module_cogni_title: 'காக்னி-பல்ஸ்', module_cogni_desc: 'அறிவாற்றல் சரிவு கண்டறிதல்', module_ayur_title: 'ஆயுர்வேத AI', module_ayur_desc: 'மருத்துவ தாவர அடையாளங்காட்டி', module_gait_title: 'கேட்-கார்ட்', module_gait_desc: 'AI தோரணை மற்றும் நடை பகுப்பாய்வு', module_ehr_title: 'EHR-சுருக்கம்', module_ehr_desc: 'சுகாதார பதிவு மொழிபெயர்ப்பாளர்', module_mindwell_title: 'மைண்ட்வெல்', module_mindwell_desc: 'பரிவுமிக்க மன துணை', module_visionfit_title: 'விஷன்-ஃபிட்', module_visionfit_desc: 'AI-இயங்கும் பிசியோதெரபிஸ்ட்', module_govschemes_title: 'அரசு சுகாதார திட்டங்கள்', module_govschemes_desc: 'உங்களுக்கு அருகிலுள்ள தொடர்புடைய திட்டங்களைக் கண்டறியவும்', module_genopredict_title: 'ஜெனோ-פ੍ּਰੋગ્નੋზი AI', module_genopredict_desc: 'மரபணு மார்க்கர் பகுப்பாய்வு',
        module_hospitalconnect_title: 'மருத்துவமனை இணைப்பு',
        module_hospitalconnect_desc: 'மருத்துவமனை செயல்பாடுகள் மற்றும் நோயாளி கவனிப்பை ஒழுங்குபடுத்துங்கள்',
        module_aiscribe_title: 'AI-Scribe',
        module_aiscribe_desc: 'குரல்-வழி மருத்துவ குறிப்புகள்',
        module_digitaltwin_title: 'டிஜிட்டல் ட்வின் சிமுலேட்டர்',
        module_digitaltwin_desc: 'வாழ்க்கை முறை மாற்றங்களை உருவகப்படுத்துங்கள்',
        module_outbreak_title: 'நோய் பரவல் முன்கணிப்பு',
        module_outbreak_desc: 'AI-இயங்கும் கொள்ளைநோய் முன்கணிப்பு'
    },
    'gu-IN':{ welcome_subtitle: 'ભારત માટે તમારી AI આરોગ્ય ઇકોસિસ્ટમ.', select_language_label: 'તમારી પસંદગીની ભાષા પસંદ કરો:', email_placeholder: 'ઈમેલ સરનામું', password_placeholder: 'પાસવર્ડ', login_button: 'લોગિન', signup_button: 'સાઇન અપ', or_divider: 'અથવા', anonymous_button: 'અનામી રીતે ચાલુ રાખો', proceed_button: 'એપ પર જાઓ', health_modules_title: 'આરોગ્ય મોડ્યુલ્સ', logout_button: 'લોગઆઉટ', ask_arogya_placeholder: 'આરોગ્યને પૂછો...', welcome_placeholder_title: 'આરોગ્યમાં આપનું સ્વાગત છે', welcome_placeholder_subtitle: 'તમારી આરોગ્ય યાત્રા શરૂ કરવા માટે ડાબેથી એક મોડ્યુલ પસંદ કરો।', auth_success_login: 'લોગિન સફળ! પ્રવેશી રહ્યું છે...', auth_success_signup: 'સાઇન અપ સફળ! સ્વાગત છે.', auth_fail: msg => `ઓપરેશન નિષ્ફળ: ${msg}`, auth_enter_details: 'કૃપા કરીને ઇમેઇલ અને પાસવર્ડ બંને દાખલ કરો।', greeting: 'નમસ્તે! હું આરોગ્ય કો-પાયલટ છું. હું આજે તમને કેવી રીતે મદદ કરી શકું?', file_read_error: 'ભૂલ: અપલોડ કરેલી ફાઇલ વાંચી શકાઈ નથી।', drop_invalid_file: type => `કૃપા કરીને એક માન્ય ${type} ફાઇલ ડ્રોપ કરો।`, upload_invalid_file: type => `ભૂલ: કૃપા કરીને એક માન્ય ${type} ਫાઈલ અપ્લોડ કરો।`, analysis_loading: 'AI તમારા ઇનપુટનું વિશ્લેષણ કરી રહ્યું છે... આમાં થોડો સમય લાગી શકે છે।', analysis_error: 'AI વિશ્લેષણ દરમિયાન એક ભૂલ આવી. કૃપા કરીને ફરી પ્રયાસ કરો।', upload_first: 'કૃપા કરીને પહેલા ઓછામાં ઓછી એક રિપોર્ટ છબી અપલોડ કરો।', upload_audio_first: 'કૃપા કરીને પહેલા એક ઓડિયો ફાઇલ અપલોડ કરો.', module_future_title: 'આરોગ્ય-ભવિષ્ય', module_future_desc: 'ભવિષ્યસૂચક આરોગ્ય આગાહીકાર', module_wellness_title: 'એઆઈ વેલनेस પ્લાનર', module_wellness_desc: 'ડાયનેમિક এઆઈ આરોગ્ય યોજના', module_healthtrend_title: 'હેલ્થ-ટ્રેન્ડ এઆઈ', module_healthtrend_desc: 'મેડિકલ રિપોર્ટ વિશ્લેષક', module_medsentry_title: 'મેડ-સેન્ટ્રી এઆઈ', module_medsentry_desc: 'ડ્રગ ઇન્ટરેક્શન તપાસનાર', module_arogyasos_title: 'આરોગ્ય-એસઓએસ', module_arogyasos_desc: 'এઆઈ ઇમરજન્સી રિસ્પોન્સ', module_sonus_title: 'સોનસ এઆઈ', module_sonus_desc: 'એકોસ્ટિક ડાયਗ્નોસ્ટિક સિસ્ટમ', module_vocaltone_title: 'વોકલ-ટોન এઆઈ', module_vocaltone_desc: 'વોકલ બાયોમાर्कर विશ્લેષણ', module_derma_title: 'ડર્માલેન્સ', module_derma_desc: 'এઆઈ ત્વચા આરોગ્ય વિશ્લેષક', module_mycro_title: 'માઇક્રો', module_mycro_desc: 'ગટ માઇક્રોબાયોમ સિમ્યુલેટર', module_cogni_title: 'કોગ્નિ-પલ્સ', module_cogni_desc: 'જ્ઞાનાત્મક ઘટાડો શોધ', module_ayur_title: 'આયુર્વેદ এઆઈ', module_ayur_desc: 'ઔષધીય વનસ્પતિ ઓળખકર્તા', module_gait_title: 'ગેટ-ગાર્ડ', module_gait_desc: 'એઆઈ પોસ્ચર અને ચાલ વિશ્લેષણ', module_ehr_title: 'ઈએચઆર-સારાંશક', module_ehr_desc: 'આરોગ્ય રેકોર્ડ દુભાષિયો', module_mindwell_title: 'માઇન્ડવેલ', module_mindwell_desc: 'સહાનુભૂતિશીલ માનસિક સાથી', module_visionfit_title: 'વિઝન-ફિટ', module_visionfit_desc: 'એઆઈ-સંચાલિત ફિઝિયોથેરાપિસ્ટ', module_govschemes_title: 'સરકારી આરોગ્ય યોજનાઓ', module_govschemes_desc: 'તમારી નજીકની સંબંધિત યોજનાઓ શોધો', module_genopredict_title: 'જીનો-પ્રેડિક્ટ એઆઈ', module_genopredict_desc: 'આનુવંશિક માર્કર વિશ્લેષણ',
        module_hospitalconnect_title: 'હોસ્પિટલ કનેક્ટ',
        module_hospitalconnect_desc: 'હોસ્પિટલની કામગીરી અને દર્દીની સંભાળને સુવ્યવસ્થિત કરો',
        module_aiscribe_title: 'AI-સ્ક્રાઇબ',
        module_aiscribe_desc: 'વૉઇસ-ટુ-ક્લિનિકલ નોટ્સ',
        module_digitaltwin_title: 'ડિજિટલ ટ્વીન સિમ્યુલેટર',
        module_digitaltwin_desc: 'જીવનશૈલીના ફેરફારોનું અનુકરણ કરો',
        module_outbreak_title: 'ફાટી નીકળવાની આગાહી કરનાર',
        module_outbreak_desc: 'AI-સંચાલિત રોગચાળાની આગાહી'
    },
    'kn-IN':{ welcome_subtitle: 'భారతಕ್ಕಾಗಿ ನಿಮ್ಮ AI ಆರೋಗ್ಯ ಪರಿಸರ ವ್ಯವಸ್ಥೆ.', select_language_label: 'ನಿಮ್ಮ ಆದ್ಯತೆಯ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ:', email_placeholder: 'ಇಮೇಲ್ ವಿಳಾಸ', password_placeholder: 'ಪಾಸ್ವರ್ಡ್', login_button: 'ಲಾಗಿನ್', signup_button: 'ಸೈನ್ ಅಪ್', or_divider: 'ಅಥವಾ', anonymous_button: 'ಅನಾಮಧೇಯವಾಗಿ ಮುಂದುವರಿಸಿ', proceed_button: 'ಅಪ್ಲಿಕೇಶನ್ಗೆ ಮುಂದುವರಿಯಿರಿ', health_modules_title: 'ಆರೋಗ್ಯ ಮಾಡ್ಯೂಲ್ಗಳು', logout_button: 'ಲಾಗ್ಔಟ್', ask_arogya_placeholder: 'ಆರೋಗ್ಯವನ್ನು ಕೇಳಿ...', welcome_placeholder_title: 'ಆರೋಗ್ಯಕ್ಕೆ ಸುಸ್ವಾಗತ', welcome_placeholder_subtitle: 'ನಿಮ್ಮ ಆರೋಗ್ಯ ಪ್ರಯಾಣವನ್ನು ಪ್ರಾರಂಭಿಸಲು ಎಡದಿಂದ ಒಂದು ಮಾಡ್ಯೂಲ್ ಆಯ್ಕೆಮಾಡಿ।', auth_success_login: 'ಲಾಗಿನ್ ಯಶಸ್ವಿಯಾಗಿದೆ! ಪ್ರವೇಶಿಸಲಾಗುತ್ತಿದೆ...', auth_success_signup: 'ಸೈನ್ ಅప్ ಯಶಸ್ವಿಯಾಗಿದೆ! ಸ್ವಾಗತ.', auth_fail: msg => `ಕಾರ್ಯಾಚರಣೆ ವಿಫಲವಾಗಿದೆ: ${msg}`, auth_enter_details: 'ದಯವಿಟ್ಟು ಇಮೇಲ್ ಮತ್ತು ಪಾಸ್ವರ್ಡ್ ಎರಡನ್ನೂ ನಮೂದಿಸಿ।', greeting: 'ನಮಸ್ಕಾರ! ನಾನು ಆರೋಗ್ಯ ಕೋ-ಪೈಲಟ್. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?', file_read_error: 'ದೋಷ: ಅಪ್ಲೋಡ್ ಮಾಡಿದ ಫೈಲ್ ಅನ್ನು ಓದಲಾಗಲಿಲ್ಲ।', drop_invalid_file: type => `ದಯವಿಟ್ಟು ಮಾನ್ಯವಾದ ${type} ಫೈಲ್ ಅನ್ನು ಡ್ರಾಪ್ ಮಾಡಿ।`, upload_invalid_file: type => `ದೋಷ: ದಯವಿಟ್ಟು ಮಾನ್ಯವಾದ ${type} ಫೈಲ್ ಅನ್ನು ಅಪ್ಲೋడ్ ಮಾಡಿ।`, analysis_loading: 'AI ನಿಮ್ಮ ಇನ್ಪುಟ್ ಅನ್ನು ವಿಶ್ಲೇಷಿಸುತ್ತಿದೆ... ಇದಕ್ಕೆ ಸ್ವಲ್ಪ ಸಮಯ ತೆಗೆದುಕೊಳ್ಳಬಹುದು।', analysis_error: 'AI ವಿಶ್ಲೇಷಣೆಯ ಸಮಯದಲ್ಲಿ ದೋಷ ಸಂಭವಿಸಿದೆ। ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ।', upload_first: 'ದಯವಿಟ್ಟು ಮೊದಲು ಕನಿಷ್ಠ ಒಂದು ವರದಿ ಚಿತ್ರವನ್ನು ಅಪ್ಲೋಡ್ ಮಾಡಿ।', upload_audio_first: 'ದಯವಿಟ್ಟು ಮೊದಲು ಆಡಿಯೊ ಫೈಲ್ ಅನ್ನು ಅಪ್ಲೋడ్ ಮಾಡಿ.', module_future_title: 'ಆರೋಗ್ಯ-ಭವಿಷ್ಯ', module_future_desc: 'ಭವಿಷ್ಯಸೂಚಕ ಆರೋಗ್ಯ ಮುನ್ಸೂಚಕ', module_wellness_title: 'ಎಐ ವೆಲ್ನೆಸ್ ಪ್ಲಾನರ್', module_wellness_desc: 'ಡೈನಾಮಿಕ್ ಎಐ ಆರೋಗ್ಯ ಯೋಜನೆ', module_healthtrend_title: 'ಆರೋಗ್ಯ-ಟ್ರೆಂಡ್ ಎಐ', module_healthtrend_desc: 'ವೈದ್ಯಕೀಯ ವರದಿ ವಿಶ್ಲೇಷಕ', module_medsentry_title: 'ಮೆಡ್-ಸೆಂಟ್ರಿ ಎಐ', module_medsentry_desc: 'ಔಷಧ ಪರಸ್ಪರ ಕ್ರಿಯೆ ಪರಿಶೀಲಕ', module_arogyasos_title: 'ಆರೋಗ್ಯ-ಎಸ್ಒಎಸ್', module_arogyasos_desc: 'ಎಐ ತುರ್ತು ಪ್ರತಿಕ್ರಿಯೆ', module_sonus_title: 'ಸೋನಸ್ ಎಐ', module_sonus_desc: 'ಅಕೌಸ್ಟಿಕ್ ಡಯಾಗ್ನೋಸ್ಟಿಕ್ ಸಿಸ್ಟಮ್', module_vocaltone_title: 'ವೋಕಲ್-ಟೋನ್ ಎಐ', module_vocaltone_desc: 'ಧ್ವನಿ ಬಯೋಮಾರ್ಕರ್ ವಿಶ್ಲೇಷಣೆ', module_derma_title: 'ಡರ್ಮಲೆನ್ಸ್', module_derma_desc: 'ಎಐ ಚರ್ಮ ಆರೋಗ್ಯ ವಿಶ್ಲೇಷಕ', module_mycro_title: 'ಮೈಕ್ರೋ', module_mycro_desc: 'ಕರುಳಿನ ಸೂಕ್ಷ್ಮಜೀವಿ ಸಿಮ್ಯುಲೇಟರ್', module_cogni_title: 'ಕಾಗ್ನಿ-ಪಲ್ಸ್', module_cogni_desc: 'ಅರಿವಿನ ಅವನತಿ ಪತ್ತೆ', module_ayur_title: 'ಆಯುರ್ವೇದ ಎಐ', module_ayur_desc: 'ಔಷಧೀಯ ಸಸ್ಯ ಗುರುತಿಸುವಿಕೆ', module_gait_title: 'ಗೈಟ್-ಗಾರ್ಡ್', module_gait_desc: 'ಎಐ ಭಂಗಿ ಮತ್ತು ನಡಿಗೆ ವಿಶ್ಲೇಷಣೆ', module_ehr_title: 'ಇಎಚ್‌ಆರ್-ಸಾರಾಂಶಕಾರ', module_ehr_desc: 'ಆರೋಗ್ಯ ದಾಖಲೆ ವ್ಯಾಖ್ಯాత', module_mindwell_title: 'ಮೈಂಡ್‌ವೆಲ್', module_mindwell_desc: 'ಸಹಾನುಭೂತಿಯ ಮಾನಸಿಕ ಸಂಗಾತಿ', module_visionfit_title: 'ವಿಷನ್-ಫಿಟ್', module_visionfit_desc: 'ಎಐ-ಚಾಲಿತ ಭೌತಚಿಕಿತ್ಸಕ', module_govschemes_title: 'ಸರ್ಕಾರಿ ಆರೋಗ್ಯ ಯೋಜನೆಗಳು', module_govschemes_desc: 'ನಿಮ್ಮ ಹತ್ತಿರದ ಸಂಬಂಧಿತ ಯೋಜನೆಗಳನ್ನು ಹುಡುಕಿ', module_genopredict_title: 'ಜೆನೊ-ಪ್ರೆಡಿಕ್ಟ್ ಎಐ', module_genopredict_desc: 'ಆನುವಂಶಿಕ ಮಾರ್ಕರ್ ವಿಶ್ಲೇಷಣೆ',
        module_hospitalconnect_title: 'ಆಸ್ಪತ್ರೆ ಸಂಪರ್ಕ',
        module_hospitalconnect_desc: 'ಆಸ್ಪತ್ರೆಯ ಕಾರ್ಯಾಚರಣೆ ಮತ್ತು ರೋಗಿಗಳ ಆರೈಕೆಯನ್ನು ಸುಧಾರಿಸಿ',
        module_aiscribe_title: 'AI-Scribe',
        module_aiscribe_desc: 'ಧ್ವನಿಯಿಂದ ವೈದ್ಯಕೀಯ ಟಿಪ್ಪಣಿಗಳು',
        module_digitaltwin_title: 'ಡಿಜಿಟಲ್ ಟ್ವಿನ್ ಸಿಮ್ಯುಲೇಟರ್',
        module_digitaltwin_desc: 'ಜೀವನಶೈಲಿ ಬದಲಾವಣೆಗಳನ್ನು ಅನುಕರಿಸಿ',
        module_outbreak_title: 'ಸಾಂಕ್ರಾಮಿಕ ಮುನ್ಸೂಚಕ',
        module_outbreak_desc: 'AI-ಚಾಲಿತ ಸಾಂಕ్రామಿಕ ಮುನ್ಸೂಚನೆ'
    },
    'ml-IN':{ welcome_subtitle: 'భారതത്തിനായുള്ള നിങ്ങളുടെ AI ആരോഗ്യ ഇക്കോസിസ്റ്റം.', select_language_label: 'നിങ്ങളുടെ ഇഷ്ട ഭാഷ തിരഞ്ഞെടുക്കുക:', email_placeholder: 'ഇമെയിൽ വിലാസം', password_placeholder: 'പാസ്വേഡ്', login_button: 'ലോഗിൻ ചെയ്യുക', signup_button: 'സൈൻ അപ്പ് ചെയ്യുക', or_divider: 'അല്ലെങ്കിൽ', anonymous_button: 'അജ്ഞാതമായി തുടരുക', proceed_button: 'ആപ്പിലേക്ക് പോകുക', health_modules_title: 'ആരോഗ്യ മൊഡ്യൂളുകൾ', logout_button: 'ലോഗ്ഔട്ട്', ask_arogya_placeholder: 'ആരോഗ്യയോട് ചോടിക്കൂ...', welcome_placeholder_title: 'ആരോഗ്യയിലേക്ക് സ്വാഗതം', welcome_placeholder_subtitle: 'നിങ്ങളുടെ ആരോഗ്യ യാത്ര ആരംഭിക്കാൻ ഇടതുവശത്ത് നിന്ന് ഒരു മൊഡ്യൂൾ തിരഞ്ഞെടുക്കുക।', auth_success_login: 'ലോഗിൻ വിജയിച്ചു! പ്രവേശിക്കുന്നു...', auth_success_signup: 'സൈൻ അപ്പ് വിജയിച്ചു! സ്വാഗതം.', auth_fail: msg => `പ്രവർത്തനം പരാജയപ്പെട്ടു: ${msg}`, auth_enter_details: 'ദയവായി ഇമെയിലും പാസ്വേഡും നൽകുക।', greeting: 'നമസ്കാരം! ഞാൻ ആരോഗ്യ കോ-പൈലറ്റ് ആണ്. ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കും?', file_read_error: 'പിശക്: അപ്ലോഡ് ചെയ്ത ഫയൽ വായിക്കാൻ കഴിഞ്ഞില്ല।', drop_invalid_file: type => `ദയവായി ഒരു സാധുവായ ${type} ఫైల్ డ్రాప్ చేయുക।`, upload_invalid_file: type => `പിശക്: ദയവായി ഒരു സാധുവായ ${type} ఫైల్ అప్లోడ్ చేయുക।`, analysis_loading: 'AI നിങ്ങളുടെ ഇൻപുട്ട് വിശകലനം ചെയ്യുന്നു... ഇതിന് കുറച്ച് സമയമെടുത്തേക്കാം।', analysis_error: 'AI വിശകലനത്തിനിടയിൽ ഒരു പിശക് സംഭവിച്ചു. ദയവായി വീണ്ടും ശ്രമിക്കുക।', upload_first: 'ദയവായി ആദ്യം ഒരു റിപ്പോർട്ട് ചിത്രം അപ്ലോഡ് ചെയ്യുക।', upload_audio_first: 'ദയവായി ആദ്യം ഒരു ഓഡിയോ ഫയൽ അപ്ലോഡ് ചെയ്യുക.', module_future_title: 'ആരോഗ്യ-ഭാവി', module_future_desc: 'പ്രവചനാത്മക ആരോഗ്യ പ്രവചന ഉപകരണം', module_wellness_title: 'എഐ വെൽനസ് പ്ലാനർ', module_wellness_desc: 'ഡൈനാമിക് എഐ ആരോഗ്യ പദ്ധതി', module_healthtrend_title: 'ഹെൽത്ത്-ട്രെൻഡ് എഐ', module_healthtrend_desc: 'മെഡിക്കൽ റിപ്പോർട്ട് അനലൈസർ', module_medsentry_title: 'മെഡ്-സെൻട്രി എഐ', module_medsentry_desc: 'മരുന്ന് ഇടപെടൽ പരിശോധകൻ', module_arogyasos_title: 'ആരോഗ്യ-എസ്ഒഎസ്', module_arogyasos_desc: 'എഐ അടിയന്തര പ്രതികരണം', module_sonus_title: 'സോണസ് എഐ', module_sonus_desc: 'അക്കോസ്റ്റിക് ഡയഗ്നോസ്റ്റിക് സിസ്റ്റം', module_vocaltone_title: 'വോക്കൽ-ടോൺ എഐ', module_vocaltone_desc: 'വോക്കൽ ബയോമാർക്കർ വിശകലനം', module_derma_title: 'ഡെർമാലെൻസ്', module_derma_desc: 'എഐ ചർമ്മ ആരോഗ്യ അനലൈസർ', module_mycro_title: 'മൈക്രോ', module_mycro_desc: 'കുടൽ മൈക്രോബയോം സിമുലേറ്റർ', module_cogni_title: 'കോഗ്നി-പൾസ്', module_cogni_desc: 'ബോധക്ഷയം കണ്ടെത്തൽ', module_ayur_title: 'ഔഷധ സസ്യം തിരിച്ചറിയൽ', module_ayur_desc: 'ഔഷധ സസ്യം തിരിച്ചറിയൽ', module_gait_title: 'ഗെയ്റ്റ്-ഗാർഡ്', module_gait_desc: 'എഐ പോസ്ചർ, ഗെയ്റ്റ് വിശകലനം', module_ehr_title: 'ഇഎച്ച്ആർ-സംഗ്രാഹകൻ', module_ehr_desc: 'ആരോഗ്യ റെക്കോർഡ് വ്യാഖ്യാതാവ്', module_mindwell_title: 'മൈൻഡ്‌വെൽ', module_mindwell_desc: 'സഹാനുഭൂതിയുള്ള മാനസിക കൂട്ടാളി', module_visionfit_title: 'വിഷൻ-ഫിറ്റ്', module_visionfit_desc: 'എഐ-പവേർഡ് ഫിസിയോതെറാപ്പിസ്റ്റ്', module_govschemes_title: 'സർക്കാർ ആരോഗ്യ പദ്ധതികൾ', module_govschemes_desc: 'നിങ്ങളുടെ അടുത്തുള്ള പ്രസക്തമായ സ്കീമുകൾ കണ്ടെത്തുക', module_genopredict_title: 'ജെനോ-പ്രെഡിക്റ്റ് എഐ', module_genopredict_desc: 'ജനിതക മാർക്കർ വിശകലനം',
        module_hospitalconnect_title: 'ആശുപത്രി കണക്റ്റ്',
        module_hospitalconnect_desc: 'ആശുപത്രി പ്രവർത്തനങ്ങളും രോഗി പരിചരണവും കാര്യക്ഷമമാക്കുക',
        module_aiscribe_title: 'AI-സ്ക്രൈബ്',
        module_aiscribe_desc: 'വോയിസ്-ടു-ക്ലിനിക്കൽ നോട്ടുകൾ',
        module_digitaltwin_title: 'ഡിജിറ്റൽ ട്വിൻ സിമുലേറ്റർ',
        module_digitaltwin_desc: 'ജീവിതശൈലി മാറ്റങ്ങൾ സിമുലേറ്റ് ചെയ്യുക',
        module_outbreak_title: 'രോഗവ്യാപന പ്രവചനം',
        module_outbreak_desc: 'AI-പവേർഡ് പകർച്ചവ്യാധി പ്രവചനം'
    },
    'pa-IN': {
        welcome_subtitle: 'ਭਾਰਤ ਲਈ ਤੁਹਾਡਾ AI ਸਿਹਤ ਈਕੋਸਿਸਟਮ।', select_language_label: 'ਆਪਣੀ ਪਸੰਦੀਦਾ ਭਾਸ਼ਾ ਚੁਣੋ:', email_placeholder: 'ਈਮੇਲ ਪਤਾ', password_placeholder: 'ਪਾਸਵਰਡ', login_button: 'ਲੌਗਇਨ', signup_button: 'ਸਾਈਨ ਅੱਪ', or_divider: 'ਜਾਂ', anonymous_button: 'ਗੁਮਨਾਮ ਜਾਰੀ ਰੱਖੋ', proceed_button: 'ਐਪ ਤੇ ਜਾਓ', health_modules_title: 'ਸਿਹਤ ਮੌਡਿਊਲ', logout_button: 'ਲੌਗਆਉਟ', ask_arogya_placeholder: 'ਆਰੋਗਿਆ ਨੂੰ ਪੁੱਛੋ...', welcome_placeholder_title: 'ਆਰੋਗਿਆ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ', welcome_placeholder_subtitle: 'ਆਪਣੀ ਸਿਹਤ ਯਾਤਰਾ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਖੱਬੇ ਪਾਸੇ ਤੋਂ ਇੱਕ ਮੌਡਿਊਲ ਚੁਣੋ।', auth_success_login: 'ਲੌਗਇਨ ਸਫਲ! ਦਾਖਲ ਹੋ ਰਿਹਾ ਹੈ...', auth_success_signup: 'ਸਾਈਨ ਅੱਪ ਸਫਲ! ਜੀ ਆਇਆਂ ਨੂੰ।', auth_fail: msg => `ਓਪਰੇਸ਼ਨ ਅਸਫਲ: ${msg}`, auth_enter_details: 'ਕਿਰਪਾ ਕਰਕੇ ਈਮੇਲ ਅਤੇ ਪਾਸਵਰਡ ਦੋਵੇਂ ਦਾਖਲ ਕਰੋ।', greeting: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਆਰੋਗਿਆ ਕੋ-ਪਾਇਲਟ ਹਾਂ। ਮੈਂ ਅੱਜ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ?', file_read_error: 'ਗਲਤੀ: ਅੱਪਲੋਡ ਕੀਤੀ ਫਾਈਲ ਨੂੰ ਪੜ੍ਹਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ।', drop_invalid_file: type => `ਕਿਰਪਾ ਕਰਕੇ ਇੱਕ ਵੈਧ ${type} ਫਾਈਲ ਸੁੱਟੋ।`, upload_invalid_file: type => `ਗਲਤੀ: ਕਿਰਪਾ ਕਰਕੇ ਇੱਕ ਵੈਧ ${type} ਫਾਈਲ ਅੱਪਲੋਡ ਕਰੋ।`, analysis_loading: 'AI ਤੁਹਾਡੇ ਇਨਪੁਟ ਦਾ ਵਿਸ਼ਲੇਸ਼ਣ ਕਰ ਰਿਹਾ ਹੈ... ਇਸ ਵਿੱਚ ਕੁਝ ਸਮਾਂ ਲੱਗ ਸਕਦਾ ਹੈ।', analysis_error: 'AI ਵਿਸ਼ਲੇਸ਼ਣ ਦੌਰਾਨ ਇੱਕ ਗਲਤੀ ਆਈ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।', upload_first: 'ਕਿਰਪਾ ਕਰਕੇ ਪਹਿਲਾਂ ਘੱਟੋ-ਘੱਟ ਇੱਕ ਰਿਪੋਰਟ ਚਿੱਤਰ ਅੱਪਲੋਡ ਕਰੋ।', upload_audio_first: 'ਕਿਰਪਾ ਕਰਕੇ ਪਹਿਲਾਂ ਇੱਕ ਆਡੀਓ ਫਾਈਲ ਅੱਪਲੋਡ ਕਰੋ।',
        module_future_title: 'ਆਰੋਗਿਆ-ਭਵਿੱਖ', module_future_desc: 'ਭਵਿੱਖਬਾਣੀ ਸਿਹਤ ਪੂਰਵ-ਸੂਚਕ',
        module_wellness_title: 'ਏਆਈ ਤੰਦਰੁਸਤੀ ਯੋਜਨਾਕਾਰ', module_wellness_desc: 'ਗਤੀਸ਼ੀਲ ਏਆਈ ਸਿਹਤ ਯੋਜਨਾ',
        module_healthtrend_title: 'ਹੈਲਥ-ਟ੍ਰੈਂਡ ਏਆਈ', module_healthtrend_desc: 'ਮੈਡੀਕਲ ਰਿਪੋਰਟ ਵਿਸ਼ਲੇਸ਼ਕ',
        module_medsentry_title: 'ਮੇਡ-ਸੈਂਟਰੀ ਏਆਈ', module_medsentry_desc: 'ਦਵਾਈਆਂ ਦੀ ਆਪਸੀ ਪ੍ਰਕਿਰਿਆ ਜਾਂਚਕਰਤਾ',
        module_arogyasos_title: 'ਆਰੋਗਿਆ-ਐਸਓਐਸ', module_arogyasos_desc: 'ਏਆਈ ਐਮਰਜЕНਸੀ ਜਵਾਬ',
        module_sonus_title: 'ਸੋਨਸ ਏਆਈ', module_sonus_desc: 'ਧੁਨੀ ਡਾਇਗਨੌਸਟਿਕ ਸਿਸਟਮ',
        module_vocaltone_title: 'ਵੋਕਲ-ਟੋਨ ਏਆਈ', module_vocaltone_desc: 'ਵੋਕਲ ਬਾਇਓਮਾਰਕਰ ਵਿਸ਼ਲੇਸ਼ਣ',
        module_derma_title: 'ਡਰਮਾਲੈਂਸ', module_derma_desc: 'ਏਆਈ ਚਮੜੀ ਸਿਹਤ ਵਿਸ਼ਲੇਸ਼ਕ',
        module_mycro_title: 'ਮਾਈਕ੍ਰੋ', module_mycro_desc: 'ਗਟ ਮਾਈਕ੍ਰੋਬਾਇਓਮ ਸਿਮੂਲੇਟਰ',
        module_cogni_title: 'ਕੋਗਨੀ-ਪਲਸ', module_cogni_desc: 'ਸੰज्ञानात्मक ਗਿਰਾਵਟ ਦੀ ਪਛਾਣ',
        module_ayur_title: 'ਆਯੁਰਵੇਦ ਏਆਈ', module_ayur_desc: 'ਔਸ਼ਧੀ ਪੌਦਾ ਪਛਾਣਕਰਤਾ',
        module_gait_title: 'ਗੇਟ-ਗਾਰਡ', module_gait_desc: 'ਏਆਈ ਆਸਣ ਅਤੇ ਚਾਲ ਵਿਸ਼ਲੇਸ਼ਣ',
        module_ehr_title: 'ਈਐਚਆਰ-ਸੰਖੇਪਕਾਰ', module_ehr_desc: 'ਸਿਹਤ ਰਿਕਾਰਡ ਦੁਭਾਸ਼ੀਆ',
        module_mindwell_title: 'ਮਾਈਂਡਵੈਲ', module_mindwell_desc: 'ਹਮਦਰਦ ਮਾਨਸਿਕ ਸਾਥੀ',
        module_visionfit_title: 'ਵਿਜ਼ਨ-ਫਿਟ', module_visionfit_desc: 'ਏਆਈ-ਸੰਚਾਲਿਤ ਫਿਜ਼ੀਓਥੈਰੇਪਿਸਟ',
        module_govschemes_title: 'ਸਰਕਾਰੀ ਸਿਹਤ ਯੋਜਨਾਵਾਂ', module_govschemes_desc: 'ਆਪਣੇ ਨੇੜੇ ਦੀਆਂ ਢੁਕਵੀਆਂ ਸਕੀਮਾਂ ਲੱਭੋ',
        module_genopredict_title: 'ਜੀਨੋ-ਪ੍ਰੈਡਿਕਟ ਏਆਈ', module_genopredict_desc: 'ਜੈਨੇਟਿਕ ਮਾਰਕਰ ਵਿਸ਼ਲੇਸ਼ਣ',
        module_hospitalconnect_title: 'ਹਸਪਤਾਲ ਕਨੈਕਟ',
        module_hospitalconnect_desc: 'ਹਸਪਤਾਲ ਦੇ ਸੰਚਾਲਨ ਅਤੇ ਮਰੀਜ਼ਾਂ ਦੀ ਦੇਖਭਾਲ ਨੂੰ ਸੁਚਾਰੂ ਬਣਾਓ',
        module_aiscribe_title: 'ਏਆਈ-ਸਕ੍ਰਾਈਬ',
        module_aiscribe_desc: 'ਵੌਇਸ-ਟੂ-ਕਲੀਨਿਕਲ ਨੋਟਸ',
        module_digitaltwin_title: 'ਡਿਜੀਟਲ ਟਵਿਨ ਸਿਮੂਲੇਟਰ',
        module_digitaltwin_desc: 'ਜੀਵਨਸ਼ੈਲੀ ਤਬਦੀਲੀਆਂ ਦਾ ਸਿਮੂਲੇਸ਼ਨ',
        module_outbreak_title: 'ਮਹਾਮਾਰੀ ਦਾ ਭਵਿੱਖਬਾਣੀ',
        module_outbreak_desc: 'ਏਆਈ-ਸੰਚਾਲਿਤ ਮਹਾਮਾਰੀ ਦੀ ਭਵਿੱਖਬਾਣੀ'
    }
};

const allModules = [
    { id: 'future', icon: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>`, type: 'multi_input' },
    { id: 'wellness', icon: `<path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>`, type: 'multi_input' },
    { id: 'healthtrend', icon: `<path d="M16 11h-2v4h2v-4zm-4 4h-2v-7h2v7zm-4-4H6v4h2v-4zM21 3H3v18h18V3zm-2 16H5V5h14v14z"/>`, type: 'image_upload' },
    { id: 'medsentry', icon: `<path d="M10.5 15.5c.33 0 .65-.08.93-.24l4.28-2.47c1.2-.69 1.2-2.45 0-3.14l-4.28-2.47a2 2 0 00-2-.01l-4.28 2.48c-.5.29-.8.78-.8 1.34v5.12c0 .56.3 1.05.8 1.34l4.28 2.48c.28.16.6.24.94.24z"/>`, type: 'text_input' },
    { id: 'arogyasos', icon: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm0-4h2V7h-2v6z"/>`, type: 'no_input' },
    { id: 'sonus', icon: `<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>`, type: 'audio_upload' },
    { id: 'vocaltone', icon: `<path d="M7 3H5v18h2V3zm12 0h-2v18h2V3zm-4 4h-2v10h2V7zm-4 0H9v10h2V7z"/>`, type: 'audio_upload' },
    { id: 'derma', icon: `<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>`, type: 'image_upload' },
    { id: 'mycro', icon: `<path d="M12 2a10 10 0 100 20 10 10 0 000-20zM8 15.5c0 .83.67 1.5 1.5 1.5.42 0 .8-.17 1.06-.44.26.27.64.44 1.06.44.83 0 1.5-.67 1.5-1.5 0-.57-.32-1.05-.76-1.31.32-.23.54-.59.54-1 .01-.82-.66-1.5-1.48-1.5-.72 0-1.31.52-1.46 1.19-.34-.31-.79-.5-1.29-.5C8.93 11.88 8 12.8 8 13.88c0 .35.14.68.38.93-.41.28-.71.7-.71 1.2zm-.5-5c.83 0 1.5-.67 1.5-1.5S8.33 7.5 7.5 7.5 6 8.17 6 9s.67 1.5 1.5 1.5zm9 0c.83 0 1.5-.67 1.5-1.5S17.33 7.5 16.5 7.5 15 8.17 15 9s.67 1.5 1.5 1.5z"/>`, type: 'text_input' },
    { id: 'cogni', icon: `<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>`, type: 'text_input' },
    { id: 'ayur', icon: `<path d="M21.25 4.34l-3.58 3.58c-.8-1.05-1.99-1.92-3.34-2.4V2h-2v3.53c-1.35.48-2.54 1.35-3.34 2.4L5.41 4.34 4 5.75l3.58 3.58C6.53 10.68 6 12.31 6 14c0 3.31 2.69 6 6 6s6-2.69 6-6c0-1.69-.53-3.32-1.43-4.66l3.58-3.58 1.1-1.42-1-1zM12 18c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>`, type: 'image_upload' },
    { id: 'gait', icon: `<path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>`, type: 'multi_input' },
    { id: 'ehr', icon: `<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>`, type: 'multi_input' },
    { id: 'mindwell', icon: `<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>`, type: 'text_input' },
    { id: 'visionfit', icon: `<path d="M4.5 11H3v2h1.5v-2zM3 20h1.5v-2.05a7.01 7.01 0 01-1.5-1.44V20zm1.5-11H3V7h1.5v2zM8 3.5H6v-2h2v2zm-2 15h2v-2H6v2zm13.5 0H18v-2h1.5v2zm-1.5-15H18v2h1.5V7zm0 11h1.5v-2H18v2zm-6.5-15h2v-2h-2v2zM12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-18c4.41 0 8 3.59 8 8s-3.59 8-8 8-8-3.59-8-8 3.59-8 8-8z"/>`, type: 'multi_input' },
    { id: 'govschemes', icon: `<path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>`, type: 'multi_input' },
    { id: 'genopredict', icon: `<path d="M14.5,15.5l1.5,1.5l-1.5,1.5V21h-1v-2.5l-1.5-1.5l1.5-1.5V13h1V15.5z M9.5,15.5l1.5,1.5l-1.5,1.5V21h-1v-2.5l-1.5-1.5 l1.5-1.5V13h1V15.5z M20,8.5c0,0-2-1.9-2-4.5c0-2.2,1.8-4,4-4c0.7,0,1.4,0.2,2,0.5C23.8,0.2,23.2,0,22.5,0C20,0,18,2,18,4.5 C18,7.1,20,8.5,20,8.5z M4.5,0C2,0,0,2,0,4.5C0,7.1,2,8.5,2,8.5C2,8.5,0,7.1,0,4.5C0,2,2,0,4.5,0C5.2,0,5.8,0.2,6.4,0.5 C5.9,0.2,5.2,0,4.5,0z"/>`, type: 'text_input' },
    { id: 'hospitalconnect', icon: `<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>`, type: 'multi_input' },
    { id: 'aiscribe', icon: `<path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z"/>`, type: 'text_input' },
    { id: 'digitaltwin', icon: `<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>`, type: 'multi_input' },
    { id: 'outbreak', icon: `<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>`, type: 'multi_input' }
];

const getTranslation = (key) => {
    const lang = state.selectedLanguage;
    if (translations[lang] && typeof translations[lang][key] !== 'undefined') {
        return translations[lang][key];
    }
    // Fallback to English if translation is missing
    return translations['en-US'][key] || key;
};

const initializeAppAndAuth = async () => {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        onAuthStateChanged(auth, user => {
            updateUIForAuthState(user);
        });

        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        }
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        getEl('auth-message-display').textContent = 'Error initializing application.';
    }
};

const handleAuthentication = async (isLogin) => {
    const email = getEl('auth-email').value;
    const password = getEl('auth-password').value;
    const display = getEl('auth-message-display');

    if (!email || !password) {
        display.textContent = getTranslation('auth_enter_details');
        return;
    }
    display.textContent = '';

    try {
        const userCredential = isLogin
            ? await signInWithEmailAndPassword(auth, email, password)
            : await createUserWithEmailAndPassword(auth, email, password);
        
        display.textContent = getTranslation(isLogin ? 'auth_success_login' : 'auth_success_signup');
    } catch (error) {
        display.textContent = getTranslation('auth_fail')(error.message.split('/')[1]?.replace(').', ''));
    }
};

const updateUIForAuthState = (user) => {
    if (user) {
        userId = user.uid;
        state.isLoggedIn = true;
        getEl('user-id-display').textContent = `ID: ${userId.substring(0, 8)}...`;
        getEl('auth-forms-container').classList.add('hidden');
        getEl('modal-proceed-button').classList.remove('hidden');
        getEl('logout-button').classList.remove('hidden');
        getEl('anonymous-button').classList.add('hidden');
    } else {
        userId = `anon-${crypto.randomUUID()}`;
        state.isLoggedIn = false;
         getEl('user-id-display').textContent = `Anonymous`;
        getEl('auth-forms-container').classList.remove('hidden');
        getEl('modal-proceed-button').classList.add('hidden');
        getEl('logout-button').classList.add('hidden');
        getEl('anonymous-button').classList.remove('hidden');
    }
};

const setLanguage = (lang) => {
    state.selectedLanguage = lang;
    document.documentElement.lang = lang.split('-')[0];
    document.querySelectorAll('[data-translate-key]').forEach(el => {
        const key = el.getAttribute('data-translate-key');
        const translation = getTranslation(key);
        if (typeof translation === 'function') return;
        
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = translation;
        } else {
            el.textContent = translation;
        }
    });
    // Also update module descriptions
    populateModules();
     if(state.activeModule) {
         const moduleData = allModules.find(m => m.id === state.activeModule);
         if(moduleData) renderModule(moduleData);
     }
};

const populateModules = () => {
    const moduleGrid = getEl('module-grid');
    moduleGrid.innerHTML = '';
    allModules.forEach(module => {
        const title = getTranslation(`module_${module.id}_title`);
        const desc = getTranslation(`module_${module.id}_desc`);
        const moduleEl = document.createElement('div');
        moduleEl.className = 'card-3d glass-panel p-4 cursor-pointer flex items-center space-x-4';
        moduleEl.innerHTML = `
            <div class="flex-shrink-0 w-12 h-12 flex items-center justify-center bg-indigo-900/50 text-indigo-300 rounded-xl">
                <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">${module.icon}</svg>
            </div>
            <div>
                <h3 class="font-bold text-lg text-gray-100">${title}</h3>
                <p class="text-sm text-gray-400">${desc}</p>
            </div>
        `;
        moduleEl.addEventListener('click', () => {
            renderModule(module);
            if(window.innerWidth < 768) { // Close sidebar on mobile after selection
                 getEl('sidebar-modules').classList.add('-translate-x-full');
                 state.isSidebarOpen = false;
            }
        });
        moduleGrid.appendChild(moduleEl);
    });

     // Add 3D card hover effect
    document.querySelectorAll('.card-3d').forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
    });
};

const renderModule = (module) => {
    state.activeModule = module.id;
    state.uploadedFiles = [];
    const welcomePlaceholder = getEl('welcome-placeholder');
    if (welcomePlaceholder) {
        welcomePlaceholder.classList.add('hidden');
    }
    
    mainModuleContent.innerHTML = ''; // Clear previous content

    const moduleContainer = document.createElement('div');
    moduleContainer.className = 'w-full max-w-3xl glass-panel p-8 animate-fade-in-up';
    moduleContainer.innerHTML = `<h3 class="text-3xl font-bold mb-4 text-center">${getTranslation(`module_${module.id}_title`)}</h3><p class="text-gray-400 mb-6 text-center">${getTranslation(`module_${module.id}_desc`)}</p>`;

    let formContent = '';

    switch (module.id) {
        case 'arogyasos':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Select your location to get localized first aid advice and find nearby hospitals.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Select State</label><select id="gov-state" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"></select></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Select District</label><select id="gov-district" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"></select></div>
                </div>
            `;
            break;

        case 'future':
            formContent = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Current Age</label><input type="number" id="future-age" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., 35"></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Gender</label><select id="future-gender" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"><option>Male</option><option>Female</option><option>Other</option></select></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Smoking Status</label><select id="future-smoking" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"><option>Non-smoker</option><option>Former smoker</option><option>Current smoker</option></select></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Weekly Exercise (hours)</label><input type="number" id="future-exercise" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., 3"></div>
                </div>
                <div class="mb-6"><label class="block mb-2 text-sm font-medium text-gray-300">Specific Health Concern / Family History (Optional)</label><textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., Family history of diabetes, high blood pressure..."></textarea></div>
            `;
            break;
        
        case 'wellness':
            formContent = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label><input type="text" id="wellness-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., Weight loss, better sleep"></div>
                     <div><label class="block mb-2 text-sm font-medium text-gray-300">Current Diet</label><input type="text" id="wellness-diet" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., Vegetarian, Non-vegetarian"></div>
                </div>
                 <div class="mb-6"><label class="block mb-2 text-sm font-medium text-gray-300">Existing Health Conditions</label><input type="text" id="wellness-conditions" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., Diabetes, High BP, None"></div>
                 <div class="mb-6"><label class="block mb-2 text-sm font-medium text-gray-300">Additional Notes</label><textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="Any preferences, allergies, or other details..."></textarea></div>
            `;
            break;

        case 'medsentry':
             formContent = `
                <div class="mb-4">
                    <label class="block mb-2 text-sm font-medium text-gray-300">What would you like to do?</label>
                    <select id="medsentry-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                        <option>Check for potential drug interactions</option>
                        <option>List common side effects for a medication</option>
                        <option>Find potential cheaper alternatives (generics)</option>
                        <option>Get a simple explanation of what a drug is for</option>
                    </select>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">List all medications, one per line</label>
                    <textarea id="text-input" class="w-full h-40 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g.,&#10;Aspirin 81mg&#10;Metformin 500mg&#10;Lisinopril 10mg"></textarea>
                </div>
                <div>
                    <p class="text-sm text-gray-400 mb-2">Or, try one of these common questions:</p>
                    <div id="medsentry-starters" class="flex flex-wrap gap-2">
                        <button class="starter-btn bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-200 text-sm font-medium py-1 px-3 rounded-full transition-colors">Can I take Paracetamol with Ibuprofen?</button>
                        <button class="starter-btn bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-200 text-sm font-medium py-1 px-3 rounded-full transition-colors">What are the side effects of Atorvastatin?</button>
                        <button class="starter-btn bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-200 text-sm font-medium py-1 px-3 rounded-full transition-colors">Is there a generic for Metformin?</button>
                    </div>
                </div>
            `;
            break;

        case 'mycro':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Describe your symptoms and goals to get insights into your gut microbiome.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Symptom / Concern</label>
                        <select id="mycro-symptom" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>General Gut Health</option>
                            <option>Bloating & Gas</option>
                            <option>Irregular Bowel Movements</option>
                            <option>Food Sensitivities</option>
                            <option>Low Energy / Fatigue</option>
                            <option>Mood Imbalances</option>
                        </select>
                    </div>
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                        <select id="mycro-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Improve Digestion</option>
                            <option>Enhance Mood & Energy</option>
                            <option>Boost Immunity</option>
                            <option>Identify Problem Foods</option>
                            <option>Optimize Diet for Gut Health</option>
                        </select>
                    </div>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Describe Your Typical Diet & Symptoms</label>
                    <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'I eat a vegetarian diet and often feel bloated after eating beans or lentils. I also experience brain fog in the afternoons.'"></textarea>
                </div>
            `;
            break;
        case 'govschemes':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Find relevant central and state-level government health schemes based on your location and needs.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Select State</label><select id="gov-state" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"></select></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Select District</label><select id="gov-district" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"></select></div>
                </div>
                <div class="mb-4">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Beneficiary Type</label>
                    <select id="gov-beneficiary" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                        <option>General Citizen</option>
                        <option>Senior Citizen</option>
                        <option>Women & Children</option>
                        <option>Person with Disability</option>
                        <option>Economically Weaker Section (EWS)</option>
                    </select>
                </div>
                <div class="mb-6"><label class="block mb-2 text-sm font-medium text-gray-300">Specific Health Concern (Optional)</label><input type="text" id="notes-input" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., Cancer treatment, Maternity, Child vaccination"></div>
            `;
            break;
        case 'genopredict':
            formContent = `
                <div class="mb-4">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Paste your raw genetic data or ask a question</label>
                    <textarea id="text-input" class="w-full h-40 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'rs1234567 A A' or 'What is the MTHFR gene?'"></textarea>
                </div>
                <div>
                    <p class="text-sm text-gray-400 mb-2">Or, try one of these common questions:</p>
                    <div id="genopredict-starters" class="flex flex-wrap gap-2">
                        <button class="starter-btn bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-200 text-sm font-medium py-1 px-3 rounded-full transition-colors">What does it mean to be a carrier for a genetic condition?</button>
                        <button class="starter-btn bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-200 text-sm font-medium py-1 px-3 rounded-full transition-colors">How do genes influence medication response?</button>
                        <button class="starter-btn bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-200 text-sm font-medium py-1 px-3 rounded-full transition-colors">Explain genetic risk for heart disease.</button>
                    </div>
                </div>
            `;
            break;

        case 'cogni':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Select your primary concern and goal to get personalized cognitive health insights.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Concern</label>
                        <select id="cogni-concern" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Memory Lapses & Forgetfulness</option>
                            <option>Difficulty Concentrating / Brain Fog</option>
                            <option>Proactive Brain Health & Longevity</option>
                            <option>Understanding Cognitive Decline Risks</option>
                            <option>Normal Age-Related Changes</option>
                        </select>
                    </div>
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                        <select id="cogni-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Improve Memory Recall</option>
                            <option>Enhance Mental Clarity & Focus</option>
                            <option>Adopt a Brain-Healthy Lifestyle</option>
                            <option>Learn Risk Reduction Strategies</option>
                            <option>Differentiate Normal vs. concerning signs</option>
                        </select>
                    </div>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Describe Your Experiences in Detail</label>
                    <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'I find it hard to remember new people's names after meeting them.' or 'I feel mentally tired and unfocused by the afternoon.'"></textarea>
                </div>
            `;
            break;

        case 'ayur':
            formContent = `
                <div id="drop-zone-${module.id}" class="mb-4 flex justify-center items-center w-full h-32 px-6 py-10 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                    <div class="text-center">
                        <svg class="mx-auto h-12 w-12 text-gray-500" stroke="currentColor" fill="none" viewBox="0 0 48 48"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                        <p class="mt-2 text-sm text-gray-400">Click to upload or drag and drop</p>
                        <p class="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
                    </div>
                </div>
                <input id="file-input-${module.id}" type="file" class="hidden" accept="image/*" multiple>
                <div id="preview-${module.id}" class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4"></div>
                <div class="mt-6"><label class="block mb-2 text-sm font-medium text-gray-300">Notes (Optional)</label><input type="text" id="notes-input" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="Add any relevant details or questions..."></div>
            `;
            break;
        case 'gait':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Upload a photo of your posture (e.g., side profile) and describe your concerns for a personalized analysis.</p>
                
                <div id="drop-zone-${module.id}" class="mb-4 flex justify-center items-center w-full h-32 px-6 py-10 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                    <div class="text-center">
                        <svg class="mx-auto h-12 w-12 text-gray-500" stroke="currentColor" fill="none" viewBox="0 0 48 48"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                        <p class="mt-2 text-sm text-gray-400">Click to upload or drag and drop a posture photo</p>
                        <p class="text-xs text-gray-500">PNG or JPG recommended</p>
                    </div>
                </div>
                <input id="file-input-${module.id}" type="file" class="hidden" accept="image/*">
                <div id="preview-${module.id}" class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4"></div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Area of Concern</label>
                        <select id="gait-area" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Overall Posture</option>
                            <option>Walking Pattern (Gait)</option>
                            <option>Back Pain/Slouching</option>
                            <option>Shoulder/Neck Position</option>
                            <option>Hip/Pelvic Tilt</option>
                            <option>Foot/Ankle Issues</option>
                        </select>
                    </div>
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                        <select id="gait-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Correct Posture</option>
                            <option>Reduce Pain</option>
                            <option>Improve Balance & Stability</option>
                            <option>Increase Walking Efficiency</option>
                            <option>Prevent Injury</option>
                        </select>
                    </div>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Describe Your Concerns in Detail</label>
                    <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'My shoulders roll forward when I use the computer.' or 'I notice my left foot turns outward when I walk.'"></textarea>
                </div>
            `;
            break;
        case 'healthtrend':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Upload a photo of your medical report and select your primary goal for a simplified AI analysis.</p>
                
                <div id="drop-zone-${module.id}" class="mb-4 flex justify-center items-center w-full h-32 px-6 py-10 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                    <div class="text-center">
                        <svg class="mx-auto h-12 w-12 text-gray-500" stroke="currentColor" fill="none" viewBox="0 0 48 48"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                        <p class="mt-2 text-sm text-gray-400">Click to upload or drag and drop a report photo</p>
                        <p class="text-xs text-gray-500">PNG or JPG recommended</p>
                    </div>
                </div>
                <input id="file-input-${module.id}" type="file" class="hidden" accept="image/*" multiple>
                <div id="preview-${module.id}" class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4"></div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Report Type</label>
                        <select id="healthtrend-type" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Blood Test Report</option>
                            <option>Urine Test Report</option>
                            <option>X-Ray Report</option>
                            <option>CT Scan Report</option>
                            <option>MRI Report</option>
                            <option>Other Medical Document</option>
                        </select>
                    </div>
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                        <select id="healthtrend-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Provide a simple summary</option>
                            <option>Explain specific medical terms</option>
                            <option>Highlight abnormal values</option>
                            <option>Generate questions to ask my doctor</option>
                        </select>
                    </div>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Specific questions or terms to focus on (Optional)</label>
                    <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'What does high creatinine mean?' or 'Explain the comments section.'"></textarea>
                </div>
            `;
            break;
        case 'sonus':
        case 'vocaltone':
             formContent = `
                <div id="drop-zone-${module.id}" class="mb-4 flex justify-center items-center w-full h-32 px-6 py-10 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                    <div class="text-center">
                        <svg class="mx-auto h-12 w-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                        <p class="mt-2 text-sm text-gray-400">Click to upload or drag and drop</p>
                        <p class="text-xs text-gray-500">MP3, WAV, M4A</p>
                    </div>
                </div>
                <input id="file-input-${module.id}" type="file" class="hidden" accept="audio/*">
                <div id="preview-${module.id}" class="mt-4"></div>
                <div class="mt-6"><label class="block mb-2 text-sm font-medium text-gray-300">Notes (Optional)</label><input type="text" id="notes-input" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., Describe symptoms like 'dry cough' or 'wheezing'..."></div>
            `;
            break;
        case 'derma':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Upload a clear photo of the affected skin area and describe your concern for a preliminary AI analysis.</p>
                <div id="drop-zone-${module.id}" class="mb-4 flex justify-center items-center w-full h-32 px-6 py-10 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                    <div class="text-center">
                        <svg class="mx-auto h-12 w-12 text-gray-500" stroke="currentColor" fill="none" viewBox="0 0 48 48"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                        <p class="mt-2 text-sm text-gray-400">Click to upload or drag and drop a skin photo</p>
                        <p class="text-xs text-gray-500">PNG or JPG recommended</p>
                    </div>
                </div>
                <input id="file-input-${module.id}" type="file" class="hidden" accept="image/*">
                <div id="preview-${module.id}" class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4"></div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Concern</label>
                        <select id="derma-concern" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Acne / Pimples</option>
                            <option>Rash / Eczema</option>
                            <option>Mole / Skin Growth</option>
                            <option>Pigmentation / Dark Spots</option>
                            <option>Signs of Aging / Wrinkles</option>
                            <option>General Skin Checkup</option>
                        </select>
                    </div>
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                        <select id="derma-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Identify the issue</option>
                            <option>Reduce Redness / Inflammation</option>
                            <option>Improve Skin Texture</option>
                            <option>Even Out Skin Tone</option>
                            <option>Get Skincare Recommendations</option>
                        </select>
                    </div>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Describe Your Symptoms in Detail</label>
                    <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'This red, itchy rash appeared on my arm 2 days ago. It hasn't spread.'"></textarea>
                </div>
            `;
            break;
        case 'hospitalconnect':
            formContent = `
                <div class="space-y-4">
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Service Needed</label>
                        <select id="hospital-service" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Appointment Booking</option>
                            <option>Ambulance Request</option>
                            <option>Check Bed Availability</option>
                            <option>General Inquiry</option>
                        </select>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block mb-2 text-sm font-medium text-gray-300">State</label>
                            <select id="gov-state" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"></select>
                        </div>
                        <div>
                            <label class="block mb-2 text-sm font-medium text-gray-300">District</label>
                            <select id="gov-district" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"></select>
                        </div>
                    </div>

                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Hospital</label>
                        <select id="hospital-select" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" disabled>
                            <option>Please select a district first</option>
                        </select>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block mb-2 text-sm font-medium text-gray-300">Patient Full Name</label>
                            <input type="text" id="patient-name" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., John Doe">
                        </div>
                        <div>
                            <label class="block mb-2 text-sm font-medium text-gray-300">Contact Number</label>
                            <input type="tel" id="contact-number" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., +919876543210">
                        </div>
                    </div>

                    <div id="appointment-date-time-group" class="hidden grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block mb-2 text-sm font-medium text-gray-300">Preferred Date</label>
                            <input type="date" id="appointment-date" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                        </div>
                        <div>
                            <label class="block mb-2 text-sm font-medium text-gray-300">Preferred Time</label>
                            <input type="time" id="appointment-time" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                        </div>
                    </div>
                    
                    <div id="emergency-location-group" class="hidden">
                        <label class="block mb-2 text-sm font-medium text-gray-300">Current Location (for Ambulance)</label>
                        <input type="text" id="emergency-location" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., Hitech City, Hyderabad">
                    </div>
                    
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Additional Details / Symptoms</label>
                        <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="Briefly describe your symptoms or specific needs..."></textarea>
                    </div>
                </div>
            `;
            break;
        
        case 'aiscribe':
            formContent = `
                <div class="text-center mb-4">
                    <p class="text-gray-400 mb-4">Click the button below and start speaking. The AI will transcribe and summarize your monologue into structured clinical notes (e.g., SOAP format).</p>
                    <button id="scribe-mic-button" class="p-4 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-all text-lg font-semibold flex items-center justify-center mx-auto gap-3">
                        <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-14 0m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                        <span id="scribe-mic-label">Start Scribing</span>
                    </button>
                </div>
                <div class="mb-6"><label class="block mb-2 text-sm font-medium text-gray-300">Transcribed & Summarized Notes</label><textarea id="text-input" class="w-full h-60 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="Your clinical notes will appear here..."></textarea></div>
            `;
            break;

        case 'digitaltwin':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Create a simplified digital model of your health profile to see the potential impact of lifestyle changes.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Resting Heart Rate (bpm)</label><input type="number" id="twin-hr" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., 70"></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Blood Pressure (e.g., 120/80)</label><input type="text" id="twin-bp" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="120/80"></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Weekly Exercise (hours)</label><input type="number" id="twin-exercise" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., 3"></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Avg. Daily Sleep (hours)</label><input type="number" id="twin-sleep" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., 7"></div>
                </div>
                <div class="mb-6"><label class="block mb-2 text-sm font-medium text-gray-300">Simulate This Change:</label><textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="Describe a lifestyle change you want to simulate. e.g., 'Increase weekly exercise to 5 hours and sleep 8 hours daily' or 'Adopt a vegetarian diet'"></textarea></div>
            `;
            break;
        
        case 'outbreak':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Analyze public health data to forecast the potential risk of infectious disease outbreaks in a selected area.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Select State</label><select id="gov-state" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"></select></div>
                    <div><label class="block mb-2 text-sm font-medium text-gray-300">Select District</label><select id="gov-district" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg"></select></div>
                </div>
                <div class="mb-6"><label class="block mb-2 text-sm font-medium text-gray-300">Key Symptoms Being Observed (comma-separated)</label><input type="text" id="notes-input" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., Fever, cough, sore throat"></div>
            `;
            break;

        case 'mindwell':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Share what's on your mind to get empathetic support and guidance from your mental companion.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Concern</label>
                        <select id="mindwell-concern" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>General Anxiety & Worry</option>
                            <option>Work/School Stress</option>
                            <option>Low Mood or Sadness</option>
                            <option>Relationship Challenges</option>
                            <option>Difficulty Focusing</option>
                            <option>Just want to talk</option>
                        </select>
                    </div>
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                        <select id="mindwell-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Understand my feelings</option>
                            <option>Find ways to cope with stress</option>
                            <option>Feel heard and supported</option>
                            <option>Explore mindfulness techniques</option>
                            <option>Improve my outlook</option>
                        </select>
                    </div>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Tell me more about what's happening</label>
                    <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="Feel free to share as much or as little as you'd like..."></textarea>
                </div>
            `;
            break;

        case 'ehr':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Paste your medical record text below and select what you'd like the AI to do.</p>
                <div class="mb-4">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Summarization Goal</label>
                    <select id="ehr-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                        <option>Provide a simple, patient-friendly summary</option>
                        <option>Extract key findings and diagnoses</option>
                        <option>List all prescribed medications and dosages</option>
                        <option>Outline the current treatment plan</option>
                        <option>Generate questions to ask my doctor</option>
                    </select>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Paste Electronic Health Record (EHR) Text Here</label>
                    <textarea id="text-input" class="w-full h-40 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="Paste the text from your medical report..."></textarea>
                </div>
            `;
            break;

        case 'visionfit':
            formContent = `
                <p class="text-gray-400 mb-6 text-center">Describe your physical discomfort or fitness goals to receive a personalized physiotherapy and exercise plan from our AI.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Area of Concern</label>
                        <select id="visionfit-area" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Lower Back</option>
                            <option>Neck & Shoulders</option>
                            <option>Knee</option>
                            <option>Ankle & Foot</option>
                            <option>Hip</option>
                            <option>Wrist & Hand</option>
                            <option>General Fitness</option>
                        </select>
                    </div>
                    <div>
                        <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                        <select id="visionfit-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                            <option>Pain Relief</option>
                            <option>Increase Flexibility</option>
                            <option>Build Strength</option>
                            <option>Improve Posture</option>
                            <option>Post-Injury Rehabilitation</option>
                        </select>
                    </div>
                </div>
                <div class="mb-6">
                    <label class="block mb-2 text-sm font-medium text-gray-300">Describe Your Symptoms or Goals in Detail</label>
                    <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'Dull ache in the lower right back, worse after sitting for long periods.' or 'I want to be able to touch my toes.'"></textarea>
                </div>
            `;
            break;

        default: // For simple text-based modules
            formContent = `<div class="mb-6"><label class="block mb-2 text-sm font-medium text-gray-300">Your Query</label><textarea id="text-input" class="w-full h-40 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="Please describe your situation or question in detail..."></textarea></div>`;
            break;
    }

    moduleContainer.innerHTML += formContent;
    
    const submitButton = document.createElement('button');
    submitButton.id = `submit-${module.id}`;
    submitButton.className = 'w-full mt-6 gradient-bg-button text-white font-bold py-3 px-8 rounded-lg text-lg';
    if (module.id === 'hospitalconnect') {
        submitButton.textContent = 'Submit Request';
    } else if (module.id === 'arogyasos') {
        submitButton.textContent = 'Get Emergency Info';
    }
    else {
        submitButton.textContent = 'Analyze';
    }
    
    const resultDiv = document.createElement('div');
    resultDiv.id = `result-${module.id}`;
    resultDiv.className = 'mt-6 text-left flex flex-col items-center justify-center';
    
    moduleContainer.appendChild(submitButton);
    moduleContainer.appendChild(resultDiv);
    mainModuleContent.appendChild(moduleContainer);

    // Add event listeners and specific logic after rendering
const setupModuleEventListeners = (module) => {
    const submitButton = getEl(`submit-${module.id}`);
    const resultDiv = getEl(`result-${module.id}`);

    if (submitButton) {
        submitButton.addEventListener('click', () => {
            let systemPrompt = `You are Arogya Co-pilot, an AI health expert. Provide a detailed, helpful, and empathetic analysis based on the user's input. The user's preferred language is ${state.selectedLanguage}. Structure your response clearly. Do not use markdown like * or #.`;
            let userInput = '';
            let analysisType = 'text'; // default

            // --- Start of Corrected Section ---
            try { // Add a try...catch block for overall safety
                switch(module.id) {
                    case 'arogyasos': {
                        const stateSelectEl = getEl('gov-state');
                        const districtSelectEl = getEl('gov-district');
                        // Safety Check: Ensure elements exist before accessing value
                        if (!stateSelectEl || !districtSelectEl) {
                             console.error("SOS module state/district dropdowns not found.");
                             resultDiv.innerHTML = `<p class="text-red-400">UI Error: Location selectors missing.</p>`;
                             return;
                        }
                        const selectedState = stateSelectEl.value;
                        const selectedDistrict = districtSelectEl.value;
                        if (!selectedState || !selectedDistrict || selectedDistrict === 'Select District') {
                            resultDiv.innerHTML = `<p class="text-red-400">Please select your state and district.</p>`;
                            return;
                        }
                        loadEmergencyData(selectedState, selectedDistrict, resultDiv);
                        return; // Prevent fall-through to callGeminiAPI
                    }
                    case 'future': {
                        const ageEl = getEl('future-age');
                        const genderEl = getEl('future-gender');
                        const smokingEl = getEl('future-smoking');
                        const exerciseEl = getEl('future-exercise');
                        const notesEl = getEl('notes-input');

                        // Safety Check: Ensure elements exist before accessing value
                        if (!ageEl || !genderEl || !smokingEl || !exerciseEl || !notesEl) {
                             console.error("One or more UI elements for 'future' module are missing.");
                             resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh the page and try again.</p>`;
                             return;
                        }
                        const age = ageEl.value;
                        const gender = genderEl.value;
                        const smoking = smokingEl.value;
                        const exercise = exerciseEl.value;
                        const notes = notesEl.value;
                        userInput = `Age: ${age}, Gender: ${gender}, Smoking: ${smoking}, Exercise: ${exercise} hours/week. Notes: ${notes || 'None'}`;
                        systemPrompt += ' Analyze the provided health data to forecast potential future health risks and offer preventive advice.';
                        analysisType = 'text';
                        break;
                    }

                    case 'wellness': {
                        const goalEl = getEl('wellness-goal');
                        const dietEl = getEl('wellness-diet');
                        const conditionsEl = getEl('wellness-conditions');
                        const notesEl = getEl('notes-input');

                        // Safety Check: Ensure elements exist before accessing value
                         if (!goalEl || !dietEl || !conditionsEl || !notesEl) {
                             console.error("One or more UI elements for 'wellness' module are missing.");
                             resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh the page and try again.</p>`;
                             return;
                        }
                        const goal = goalEl.value;
                        const diet = dietEl.value;
                        const conditions = conditionsEl.value;
                        const wellnessNotes = notesEl.value;
                        userInput = `Primary Goal: ${goal}, Current Diet: ${diet}, Existing Conditions: ${conditions}. Additional Notes: ${wellnessNotes || 'None'}`;
                        systemPrompt += ' Create a personalized wellness plan including diet, exercise, and lifestyle suggestions based on the user\'s goals and conditions.';
                        analysisType = 'text';
                        break;
                    }

                    case 'medsentry': {
                         const goalEl = getEl('medsentry-goal');
                         const medicationsEl = getEl('text-input');

                         // Safety Check: Ensure elements exist before accessing value
                         if (!goalEl || !medicationsEl) {
                             console.error("One or more UI elements for 'medsentry' module are missing.");
                             resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh the page and try again.</p>`;
                             return;
                         }
                        const goal = goalEl.value;
                        const medications = medicationsEl.value;
                        if (!medications) {
                            resultDiv.innerHTML = `<p class="text-red-400">Please list at least one medication.</p>`;
                            return;
                        }
                        userInput = `Goal: "${goal}". Medications listed:\n${medications}`;
                        systemPrompt += ` You are Med-Sentry AI, a drug interaction and information checker. Based on the user's goal and the list of medications, provide a clear and concise analysis. For interactions, clearly state potential risks. For side effects, list the most common ones. For alternatives, suggest generic names if available. For explanations, describe the drug's purpose in simple terms. ALWAYS include a disclaimer that this is not medical advice and the user must consult a doctor or pharmacist before making any changes to their medication.`;
                        analysisType = 'text';
                        break;
                    }

                    case 'healthtrend': {
                        const reportTypeEl = getEl('healthtrend-type');
                        const goalEl = getEl('healthtrend-goal');
                        const notesEl = getEl('notes-input');

                        // Safety Check: Ensure elements exist before accessing value
                         if (!reportTypeEl || !goalEl || !notesEl) {
                             console.error("One or more UI elements for 'healthtrend' module are missing.");
                             resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh the page and try again.</p>`;
                             return;
                         }
                        if (state.uploadedFiles.length === 0) {
                            resultDiv.innerHTML = `<p class="text-red-400">${getTranslation('upload_first')}</p>`;
                            return;
                        }
                        const reportType = reportTypeEl.value;
                        const goal = goalEl.value;
                        const notes = notesEl.value;
                        userInput = `Report Type: ${reportType}. Primary Goal: "${goal}". Specific questions/focus: ${notes || 'None'}`;
                        systemPrompt += ` You are Health-Trend AI, a medical report analyzer. Based on the user's uploaded medical report image(s) AND their specified report type, goal, and questions, provide a detailed analysis. Your goal is to simplify and interpret complex medical documents for a layperson. If the goal is a summary, provide one. If it's to explain terms, do so. If it's to highlight abnormal values, find them and explain their significance in simple terms. If generating questions for a doctor, make them clear and relevant. You MUST state clearly that this is not a medical diagnosis and the user should consult their doctor for any medical advice.`;
                        analysisType = 'image';
                        break;
                    }

                    case 'ayur':
                    case 'derma':
                    case 'gait': { // Group similar image upload modules
                         const notesEl = getEl('notes-input');
                         let notesValue = '';
                         // Safety Check: Ensure notes element exists before accessing value
                         if (notesEl) {
                             notesValue = notesEl.value;
                         } else {
                              console.warn(`Optional 'notes-input' not found for module '${module.id}'`);
                         }

                         if (state.uploadedFiles.length === 0) {
                            resultDiv.innerHTML = `<p class="text-red-400">${getTranslation('upload_first')}</p>`; // Assumes image upload
                            return;
                         }
                         userInput = notesValue || `Analyze the provided image(s).`; // Use notes or default prompt

                         // Add specific prompts based on module
                         if(module.id === 'ayur') {
                            systemPrompt += ` Analyze the uploaded image(s) to identify the medicinal plant. Provide details about its traditional Ayurvedic uses, properties, and preparation methods if applicable. Consider the user's notes: ${notesValue || 'None'}`;
                         } else if (module.id === 'derma') {
                             const concernEl = getEl('derma-concern');
                             const goalEl = getEl('derma-goal');
                             // Safety Check: Ensure elements exist
                              if (!concernEl || !goalEl) {
                                  console.error("Missing concern/goal dropdowns for 'derma' module.");
                                  resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh.</p>`;
                                  return;
                              }
                             userInput = `Primary Concern: ${concernEl.value}, Primary Goal: ${goalEl.value}. Detailed description: ${notesValue}`;
                             systemPrompt += `You are Dermalens, an AI skin health analyzer. Based on the user's uploaded photo AND their described concern, goal, and detailed symptoms, provide a preliminary analysis. Identify potential conditions, suggest possible next steps (e.g., moisturizing, avoiding irritants), and provide skincare advice. You MUST state clearly that this is not a medical diagnosis and the user should consult a dermatologist for any persistent or worrying conditions.`;
                         } else if (module.id === 'gait') {
                             const areaEl = getEl('gait-area');
                             const goalEl = getEl('gait-goal');
                             // Safety Check: Ensure elements exist
                              if (!areaEl || !goalEl) {
                                  console.error("Missing area/goal dropdowns for 'gait' module.");
                                  resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh.</p>`;
                                  return;
                              }
                             userInput = `Area of Concern: ${areaEl.value}, Primary Goal: ${goalEl.value}. Detailed description: ${notesValue}`;
                             systemPrompt += `You are Gait-Guard AI. Analyze the uploaded posture photo and the user's description (${userInput}) to identify potential musculoskeletal issues or postural deviations. Suggest potential causes and recommend general corrective exercises or ergonomic advice. State clearly this is not a substitute for professional medical or physiotherapy assessment.`;
                         }
                         analysisType = 'image';
                         break;
                    }

                    // --- Corrected Sonus/VocalTone ---
                    case 'sonus':
                    case 'vocaltone': {
                        const notesInputEl = getEl('notes-input');
                        let notesValue = '';
                         // Safety Check: Ensure notes element exists before accessing value
                        if (notesInputEl) {
                            notesValue = notesInputEl.value;
                        } else {
                            console.warn(`Optional 'notes-input' not found for module '${module.id}'`);
                        }

                        if (state.uploadedFiles.length === 0) {
                            resultDiv.innerHTML = `<p class="text-red-400">${getTranslation('upload_audio_first')}</p>`;
                            return; // Stop if no file
                        }

                        userInput = notesValue || `Analyze the uploaded audio file.`; // Use notes or a default prompt
                        if (module.id === 'sonus') {
                             systemPrompt += ` You are Sonus AI. Analyze the uploaded audio file (likely cough or breathing sounds) for acoustic characteristics potentially indicative of respiratory conditions. Consider the user's notes: ${notesValue || 'None'}. Provide a preliminary analysis, but emphasize this is not a diagnosis and a doctor should be consulted.`;
                        } else { // vocaltone
                             systemPrompt += ` You are Vocal-Tone AI. Analyze the uploaded voice recording for vocal biomarkers (like pitch, jitter, shimmer) that could subtly indicate underlying health issues. Consider the user's notes: ${notesValue || 'None'}. Explain findings in simple terms and state this is an experimental analysis, not a medical diagnosis.`;
                        }
                        analysisType = 'audio'; // Set the correct analysis type
                        break;
                    }
                    // --- End Corrected Sonus/VocalTone ---

                    case 'mindwell': {
                        const concernEl = getEl('mindwell-concern');
                        const goalEl = getEl('mindwell-goal');
                        const notesEl = getEl('notes-input');
                        // Safety Check: Ensure elements exist
                         if (!concernEl || !goalEl || !notesEl) {
                            console.error("One or more UI elements for 'mindwell' module are missing.");
                            resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh.</p>`;
                            return;
                         }
                        const concern = concernEl.value;
                        const goal = goalEl.value;
                        const notes = notesEl.value;
                        userInput = `Primary Concern: ${concern}, Primary Goal: ${goal}. Detailed description: ${notes}`;
                        systemPrompt += `You are MindWell, an empathetic AI mental health companion. Based on the user's primary concern, goal, and detailed description, provide a supportive and understanding response. Listen carefully to their feelings, validate their experience, and offer gentle, constructive perspectives or mindfulness techniques relevant to their situation. Your role is to be a safe, non-judgmental space. You are not a therapist and must not provide medical advice or diagnosis. If the user expresses thoughts of self-harm or is in a crisis, you must gently and immediately guide them to seek professional help by providing emergency contact numbers (e.g., a relevant crisis hotline for India like AASRA: +91-9820466726) and encouraging them to speak with a qualified professional. The user's preferred language is ${state.selectedLanguage}.`;
                        analysisType = 'text';
                        break;
                    }

                    case 'govschemes': {
                        const stateEl = getEl('gov-state');
                        const districtEl = getEl('gov-district');
                        const beneficiaryEl = getEl('gov-beneficiary');
                        const concernEl = getEl('notes-input'); // Note: shared ID
                        // Safety Check: Ensure elements exist
                         if (!stateEl || !districtEl || !beneficiaryEl || !concernEl) {
                            console.error("One or more UI elements for 'govschemes' module are missing.");
                            resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh.</p>`;
                            return;
                         }
                        const selectedState = stateEl.value;
                        const selectedDistrict = districtEl.value;
                        const beneficiary = beneficiaryEl.value;
                        const concern = concernEl.value;
                         if (!selectedState || !selectedDistrict || selectedDistrict === 'Select District') {
                            resultDiv.innerHTML = `<p class="text-red-400">Please select your state and district.</p>`;
                            return;
                         }
                        userInput = `Find government health schemes for State: ${selectedState}, District: ${selectedDistrict}. I am looking for schemes for a '${beneficiary}'. My specific concern is: '${concern || 'General health needs'}'.`;
                        systemPrompt += ' You are an expert on Indian government health schemes. Find and list relevant central and state-level government health schemes based on the user\'s location, beneficiary type, and health concern. For each scheme, provide a clear summary, key benefits, eligibility criteria, and simple instructions on how to apply. Format the response for easy readability.';
                        analysisType = 'text';
                        break;
                    }

                    case 'hospitalconnect': {
                        const serviceEl = getEl('hospital-service');
                        const stateEl = getEl('gov-state');
                        const districtEl = getEl('gov-district');
                        const hospitalEl = getEl('hospital-select');
                        const patientNameEl = getEl('patient-name');
                        const contactNumberEl = getEl('contact-number');
                        const dateEl = getEl('appointment-date');
                        const timeEl = getEl('appointment-time');
                        const locationEl = getEl('emergency-location');
                        const notesEl = getEl('notes-input');

                        // Safety Check: Ensure all potentially needed elements exist
                         if (!serviceEl || !stateEl || !districtEl || !hospitalEl || !patientNameEl || !contactNumberEl || !dateEl || !timeEl || !locationEl || !notesEl) {
                             console.error("One or more UI elements for 'hospitalconnect' module are missing.");
                             resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh the page and try again.</p>`;
                             return;
                         }

                        const service = serviceEl.value;
                        const hospitalState = stateEl.value;
                        const hospitalDistrict = districtEl.value;
                        const hospitalName = hospitalEl.value;
                        const patientName = patientNameEl.value;
                        const contactNumber = contactNumberEl.value;
                        const appointmentDate = dateEl.value;
                        const appointmentTime = timeEl.value;
                        const emergencyLocation = locationEl.value;
                        const hospitalNotes = notesEl.value;

                        // Basic validation
                        if (!hospitalState || !hospitalDistrict || hospitalDistrict === 'Select District' || !hospitalName || hospitalName === 'Please select a district first' || !patientName || !contactNumber) {
                             resultDiv.innerHTML = `<p class="text-red-400">Please fill in State, District, Hospital, Name, and Contact Number.</p>`;
                             return;
                        }
                         if (service === 'Appointment Booking' && (!appointmentDate || !appointmentTime)) {
                              resultDiv.innerHTML = `<p class="text-red-400">Please select a preferred date and time for the appointment.</p>`;
                              return;
                         }
                         if (service === 'Ambulance Request' && !emergencyLocation) {
                              resultDiv.innerHTML = `<p class="text-red-400">Please provide the current location for the ambulance request.</p>`;
                              return;
                         }

                        userInput = `Service Request: ${service}. Location: ${hospitalDistrict}, ${hospitalState}. Hospital: ${hospitalName}. Patient Name: ${patientName}. Contact Number: ${contactNumber}.`;
                         if (service === 'Appointment Booking') {
                             userInput += ` Preferred Date: ${appointmentDate}. Preferred Time: ${appointmentTime}.`;
                         }
                         if (service === 'Ambulance Request') {
                              userInput += ` Emergency Location: ${emergencyLocation}.`;
                         }
                        userInput += ` Notes/Symptoms: ${hospitalNotes || 'None'}`;

                        systemPrompt = `You are an automated hospital booking assistant named Arogya. The user's preferred language is ${state.selectedLanguage}. Based on the user's request, generate a clear, professional confirmation message. State that their request has been successfully submitted to the specified hospital. Reiterate all the relevant details provided by the user (Service, Patient Name, Hospital, Contact Number, and specific details like date/time or location based on service type) in the confirmation. For ambulance requests, state that the hospital has been notified and will dispatch an ambulance to the provided location. For bed availability or general inquiries, state that the hospital will contact them shortly on their provided number. Do not use markdown.`;
                        analysisType = 'text';
                        break;
                    }

                    case 'digitaltwin': {
                        const hrEl = getEl('twin-hr');
                        const bpEl = getEl('twin-bp');
                        const exerciseEl = getEl('twin-exercise');
                        const sleepEl = getEl('twin-sleep');
                        const scenarioEl = getEl('notes-input'); // Shared ID

                        // Safety Check: Ensure elements exist
                         if (!hrEl || !bpEl || !exerciseEl || !sleepEl || !scenarioEl) {
                             console.error("One or more UI elements for 'digitaltwin' module are missing.");
                             resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh.</p>`;
                             return;
                         }
                        const hr = hrEl.value;
                        const bp = bpEl.value;
                        const exercise = exerciseEl.value;
                        const sleep = sleepEl.value;
                        const scenario = scenarioEl.value;
                        userInput = `Current Health Profile: Resting Heart Rate=${hr || 'N/A'}bpm, Blood Pressure=${bp || 'N/A'}, Weekly Exercise=${exercise || 'N/A'}hrs, Daily Sleep=${sleep || 'N/A'}hrs. Simulated Scenario: ${scenario}`;
                        systemPrompt += `You are a health simulation AI. Based on the user's health profile, analyze the likely long-term (1-5 year) impact of the simulated lifestyle change described in the scenario. Discuss potential improvements or changes in health metrics (like heart rate, BP), reduction or increase in chronic disease risk (like diabetes, hypertension), and overall well-being. Provide a balanced, evidence-based forecast. Acknowledge any missing current data.`;
                         analysisType = 'text';
                        break;
                    }

                    case 'outbreak': {
                        const stateEl = getEl('gov-state');
                        const districtEl = getEl('gov-district');
                        const symptomsEl = getEl('notes-input'); // Shared ID

                        // Safety Check: Ensure elements exist
                        if (!stateEl || !districtEl || !symptomsEl) {
                             console.error("One or more UI elements for 'outbreak' module are missing.");
                             resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh.</p>`;
                             return;
                        }
                        const outbreakState = stateEl.value;
                        const outbreakDistrict = districtEl.value;
                        const symptoms = symptomsEl.value;
                         if (!outbreakState || !outbreakDistrict || outbreakDistrict === 'Select District') {
                            resultDiv.innerHTML = `<p class="text-red-400">Please select your state and district.</p>`;
                            return;
                         }
                        userInput = `Location for Analysis: ${outbreakDistrict}, ${outbreakState}. Key symptoms observed in the community: ${symptoms || 'None specified'}.`;
                        systemPrompt += `You are an epidemiologist AI. Based on the location and reported symptoms, provide a risk assessment for a potential infectious disease outbreak. Consider seasonality, general population density awareness for India, and common symptom patterns. Suggest common potential pathogens (if symptoms are indicative) and recommend general public health and safety measures (e.g., hygiene, masking if respiratory, seeking medical advice). Provide a risk level (Low, Moderate, High, Very High) with justification. State limitations if symptoms are vague.`;
                         analysisType = 'text';
                        break;
                    }

                    case 'visionfit': {
                        const areaEl = getEl('visionfit-area');
                        const goalEl = getEl('visionfit-goal');
                        const notesEl = getEl('notes-input'); // Shared ID

                        // Safety Check: Ensure elements exist
                         if (!areaEl || !goalEl || !notesEl) {
                            console.error("One or more UI elements for 'visionfit' module are missing.");
                            resultDiv.innerHTML = `<p class="text-red-400">A critical UI error occurred. Please refresh.</p>`;
                            return;
                         }
                        const area = areaEl.value;
                        const goal = goalEl.value;
                        const notes = notesEl.value;
                        userInput = `Area of Concern: ${area}, Primary Goal: ${goal}. Detailed description: ${notes}`;
                        systemPrompt += `You are Vision-Fit, an AI-powered physiotherapist assistant. Based on the user's area of concern, goal, and detailed description, create a safe, *general* exercise and stretching plan suitable for preliminary guidance. Provide clear instructions for 2-3 suggested exercises/stretches, including reps/duration, sets, and frequency. Include important general warnings (e.g., 'stop if pain occurs', 'consult a professional'). Structure the response clearly. Crucially, state that this is NOT a substitute for professional physiotherapy assessment and diagnosis, especially for injuries or persistent pain.`;
                        analysisType = 'text';
                        break;
                    }

                    // --- Corrected Default Case ---
                    default: {
                        console.log('DEBUG: Trying to get text-input in default case for module:', module.id); // <-- ADD THIS LINE
                        userInput = getEl('text-input').value; // Original line causing error
                        // Safety Check: Check if textInputEl exists before using it
                        if (textInputEl) {
                            userInput = textInputEl.value;
                        } else {
                            // Fallback attempt for modules incorrectly hitting default
                            const notesInputEl = getEl('notes-input');
                            if (notesInputEl) {
                                userInput = notesInputEl.value;
                                console.warn(`Module '${module.id}' fell back to using 'notes-input' in default case.`);
                            } else {
                                 // If it's not supposed to have text input (like an upload module hitting default by error)
                                 if (module.type === 'image_upload' || module.type === 'audio_upload') {
                                     if(state.uploadedFiles.length > 0){
                                        userInput = `Analyze the uploaded file for module ${module.id}.`; // Provide generic prompt
                                        console.warn(`Module '${module.id}' using default case with file upload.`);
                                     } else {
                                         console.error(`No input field ('text-input' or 'notes-input') and no file uploaded for default module case: '${module.id}'`);
                                         resultDiv.innerHTML = `<p class="text-red-400">Error: No input provided for this module.</p>`;
                                         return;
                                     }
                                 } else {
                                     // Truly missing input for a module that should have it
                                     console.error(`No 'text-input' or 'notes-input' found for default module case: '${module.id}'`);
                                     resultDiv.innerHTML = `<p class="text-red-400">Error: Input field not found for this module.</p>`;
                                     return;
                                 }
                            }
                        }
                        // Set analysis type based on module config, defaulting to text
                        if (module.type === 'image_upload') analysisType = 'image';
                        else if (module.type === 'audio_upload') analysisType = 'audio';
                        // Keep analysisType as 'text' for 'multi_input' or unknown types falling here
                        else analysisType = 'text';
                        break;
                    }
                     // --- End Corrected Default Case ---

                } // End switch

            } catch (err) {
                 console.error(`Error processing input for module ${module.id}:`, err);
                 resultDiv.innerHTML = `<p class="text-red-400">An unexpected error occurred while preparing your request. Please check console.</p>`;
                 return; // Prevent API call on error
            }
            // --- End of Corrected Section ---


            // Determine if input is actually required and present
            const requiresTextInput = (analysisType === 'text' && module.type !== 'no_input');
            const requiresFileUpload = (analysisType === 'image' || analysisType === 'audio');

            // Final check before calling API
            if (requiresTextInput && (!userInput || !userInput.trim())) {
                 resultDiv.innerHTML = `<p class="text-red-400">Please provide the required text input for analysis.</p>`;
                 return;
            }
            // File upload presence is checked within specific cases ('healthtrend', 'ayur', 'derma', 'gait', 'sonus', 'vocaltone')

            // Proceed to API call if checks pass
            callGeminiAPI(systemPrompt, userInput, resultDiv, analysisType);
        });
    }

    // --- File Upload Logic (Unchanged but needs the elements to exist) ---
    const dropZone = getEl(`drop-zone-${module.id}`);
    const fileInput = getEl(`file-input-${module.id}`);
    const previewContainer = getEl(`preview-${module.id}`);

    if (dropZone && fileInput && previewContainer) {
        const type = (module.id === 'sonus' || module.id === 'vocaltone') ? 'audio' : 'image';

        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files, previewContainer, type));

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('bg-white/10');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('bg-white/10');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('bg-white/10');
            handleFileUpload(e.dataTransfer.files, previewContainer, type);
        });
    } else if (module.type === 'image_upload' || module.type === 'audio_upload') {
        // Log error if file handling elements are missing for modules that need them
        console.error(`File upload elements (drop-zone, file-input, or preview) missing for module: ${module.id}`);
    }

    // --- State/District Dropdown Logic (Added safety checks) ---
    if (['govschemes', 'hospitalconnect', 'outbreak', 'arogyasos'].includes(module.id)) {
        const indianStates = { /* ... Keep your full indianStates object here ... */
            "Andaman and Nicobar Islands": ["Nicobar", "North and Middle Andaman", "South Andaman"],
            "Andhra Pradesh": ["Anantapur", "Chittoor", "East Godavari", "Guntur", "Krishna", "Kurnool", "Prakasam", "Sri Potti Sriramulu Nellore", "Srikakulam", "Visakhapatnam", "Vizianagaram", "West Godavari", "YSR Kadapa"],
            "Arunachal Pradesh": ["Tawang", "West Kameng", "East Kameng", "Papum Pare", "Kurung Kumey", "Kra Daadi", "Lower Subansiri", "Upper Subansiri", "West Siang", "East Siang", "Siang", "Upper Siang", "Lower Siang", "Lower Dibang Valley", "Dibang Valley", "Anjaw", "Lohit", "Namsai", "Changlang", "Tirap", "Longding"],
            "Assam": ["Baksa", "Barpeta", "Biswanath", "Bongaigaon", "Cachar", "Charaideo", "Chirang", "Darrang", "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao", "Goalpara", "Golaghat", "Hailakandi", "Hojai", "Jorhat", "Kamrup", "Kamrup Metropolitan", "Karbi Anglong", "Karimganj", "Kokrajhar", "Lakhimpur", "Majuli", "Morigaon", "Nagaon", "Nalbari", "Sivasagar", "Sonitpur", "South Salmara-Mankachar", "Tinsukia", "Udalguri", "West Karbi Anglong"],
            "Bihar": ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "East Champaran", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran"],
            "Chandigarh": ["Chandigarh"],
            "Chhattisgarh": ["Balod", "Baloda Bazar", "Balrampur", "Bastar", "Bemetara", "Bijapur", "Bilaspur", "Dantewada", "Dhamtari", "Durg", "Gariaband", "Janjgir-Champa", "Jashpur", "Kanker", "Kabirdham", "Kondagaon", "Korba", "Koriya", "Mahasamund", "Mungeli", "Narayanpur", "Raigarh", "Raipur", "Rajnandgaon", "Sukma", "Surajpur", "Surguja"],
            "Dadra and Nagar Haveli and Daman and Diu": ["Daman", "Diu", "Dadra and Nagar Haveli"],
            "Delhi": ["Central Delhi", "East Delhi", "New Delhi", "North Delhi", "North East Delhi", "North West Delhi", "Shahdara", "South Delhi", "South East Delhi", "South West Delhi", "West Delhi"],
            "Goa": ["North Goa", "South Goa"],
            "Gujarat": ["Ahmedabad", "Amreli", "Anand", "Aravalli", "Banaskantha", "Bharuch", "Bhavnagar", "Botad", "Chhota Udaipur", "Dahod", "Dang", "Devbhoomi Dwarka", "Gandhinagar", "Gir Somnath", "Jamnagar", "Junagadh", "Kheda", "Kutch", "Mahisagar", "Mehsana", "Morbi", "Narmada", "Navsari", "Panchmahal", "Patan", "Porbandar", "Rajkot", "Sabarkantha", "Surat", "Surendranagar", "Tapi", "Vadodara", "Valsad"],
            "Haryana": ["Ambala", "Bhiwani", "Charkhi Dadri", "Faridabad", "Fatehabad", "Gurugram", "Hisar", "Jhajjar", "Jind", "Kaithal", "Karnal", "Kurukshetra", "Mahendragarh", "Nuh", "Palwal", "Panchkula", "Panipat", "Rewari", "Rohtak", "Sirsa", "Sonipat", "Yamunanagar"],
            "Himachal Pradesh": ["Bilaspur", "Chamba", "Hamirpur", "Kangra", "Kinnaur", "Kullu", "Lahaul and Spiti", "Mandi", "Shimla", "Sirmaur", "Solan", "Una"],
            "Jammu and Kashmir": ["Anantnag", "Bandipora", "Baramulla", "Budgam", "Doda", "Ganderbal", "Jammu", "Kathua", "Kishtwar", "Kulgam", "Kupwara", "Poonch", "Pulwama", "Rajouri", "Ramban", "Reasi", "Samba", "Shopian", "Srinagar", "Udhampur"],
            "Jharkhand": ["Bokaro", "Chatra", "Deoghar", "Dhanbad", "Dumka", "East Singhbhum", "Garhwa", "Giridih", "Godda", "Gumla", "Hazaribagh", "Jamtara", "Khunti", "Koderma", "Latehar", "Lohardaga", "Pakur", "Palamu", "Ramgarh", "Ranchi", "Sahebganj", "Seraikela Kharsawan", "Simdega", "West Singhbhum"],
            "Karnataka": ["Bagalkot", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban", "Bidar", "Chamarajanagar", "Chikkaballapur", "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad", "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal", "Mandya", "Mysuru", "Raichur", "Ramanagara", "Shivamogga", "Tumakuru", "Udupi", "Uttara Kannada", "Vijayapura", "Yadgir"],
            "Kerala": ["Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod", "Kollam", "Kottayam", "Kozhikode", "Malappuram", "Palakkad", "Pathanamthitta", "Thiruvananthapuram", "Thrissur", "Wayanad"],
            "Ladakh": ["Kargil", "Leh"],
            "Lakshadweep": ["Lakshadweep"],
            "Madhya Pradesh": ["Agar Malwa", "Alirajpur", "Anuppur", "Ashoknagar", "Balaghat", "Barwani", "Betul", "Bhind", "Bhopal", "Burhanpur", "Chhatarpur", "Chhindwara", "Damoh", "Datia", "Dewas", "Dhar", "Dindori", "Guna", "Gwalior", "Harda", "Hoshangabad", "Indore", "Jabalpur", "Jhabua", "Katni", "Khandwa", "Khargone", "Mandla", "Mandsaur", "Morena", "Narsinghpur", "Neemuch", "Panna", "Raisen", "Rajgarh", "Ratlam", "Rewa", "Sagar", "Satna", "Sehore", "Seoni", "Shahdol", "Shajapur", "Sheopur", "Shivpuri", "Sidhi", "Singrauli", "Tikamgarh", "Ujjain", "Umaria", "Vidisha"],
            "Maharashtra": ["Ahmednagar", "Akola", "Amravati", "Aurangabad", "Beed", "Bhandara", "Buldhana", "Chandrapur", "Dhule", "Gadchiroli", "Gondia", "Hingoli", "Jalgaon", "Jalna", "Kolhapur", "Latur", "Mumbai City", "Mumbai Suburban", "Nagpur", "Nanded", "Nandurbar", "Nashik", "Osmanabad", "Palghar", "Parbhani", "Pune", "Raigad", "Ratnagiri", "Sangli", "Satara", "Sindhudurg", "Solapur", "Thane", "Wardha", "Washim", "Yavatmal"],
            "Manipur": ["Bishnupur", "Chandel", "Churachandpur", "Imphal East", "Imphal West", "Jiribam", "Kakching", "Kamjong", "Kangpokpi", "Noney", "Pherzawl", "Senapati", "Tamenglong", "Tengnoupal", "Thoubal", "Ukhrul"],
            "Meghalaya": ["East Garo Hills", "East Jaintia Hills", "East Khasi Hills", "North Garo Hills", "Ri Bhoi", "South Garo Hills", "South West Garo Hills", "South West Khasi Hills", "West Garo Hills", "West Jaintia Hills", "West Khasi Hills"],
            "Mizoram": ["Aizawl", "Champhai", "Hnahthial", "Khawzawl", "Kolasib", "Lawngtlai", "Lunglei", "Mamit", "Saiha", "Saitual", "Serchhip"],
            "Nagaland": ["Dimapur", "Kiphire", "Kohima", "Longleng", "Mokokchung", "Mon", "Peren", "Phek", "Tuensang", "Wokha", "Zunheboto"],
            "Odisha": ["Angul", "Balangir", "Balasore", "Bargarh", "Bhadrak", "Boudh", "Cuttack", "Deogarh", "Dhenkanal", "Gajapati", "Ganjam", "Jagatsinghpur", "Jajpur", "Jharsuguda", "Kalahandi", "Kandhamal", "Kendrapara", "Keonjhar", "Khordha", "Koraput", "Malkangiri", "Mayurbhanj", "Nabarangpur", "Nayagarh", "Nuapada", "Puri", "Rayagada", "Sambalpur", "Subarnapur", "Sundargarh"],
            "Puducherry": ["Karaikal", "Mahe", "Puducherry", "Yanam"],
            "Punjab": ["Amritsar", "Barnala", "Bathinda", "Faridkot", "Fatehgarh Sahib", "Fazilka", "Ferozepur", "Gurdaspur", "Hoshiarpur", "Jalandhar", "Kapurthala", "Ludhiana", "Mansa", "Moga", "Mohali", "Muktsar", "Pathankot", "Patiala", "Rupnagar", "Sangrur", "Shaheed Bhagat Singh Nagar", "Tarn Taran"],
            "Rajasthan": ["Ajmer", "Alwar", "Banswara", "Baran", "Barmer", "Bharatpur", "Bhilwara", "Bikaner", "Bundi", "Chittorgarh", "Churu", "Dausa", "Dholpur", "Dungarpur", "Hanumangarh", "Jaipur", "Jaisalmer", "Jalore", "Jhalawar", "Jhunjhunu", "Jodhpur", "Karauli", "Kota", "Nagaur", "Pali", "Pratapgarh", "Rajsamand", "Sawai Madhopur", "Sikar", "Sirohi", "Sri Ganganagar", "Tonk", "Udaipur"],
            "Sikkim": ["East Sikkim", "North Sikkim", "South Sikkim", "West Sikkim"],
            "Tamil Nadu": ["Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram", "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli", "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar"],
            "Telangana": ["Adilabad", "Bhadradri Kothagudem", "Hyderabad", "Jagtial", "Jangaon", "Jayashankar Bhupalpally", "Jogulamba Gadwal", "Kamareddy", "Karimnagar", "Khammam", "Komaram Bheem", "Mahabubabad", "Mahabubnagar", "Mancherial", "Medak", "Medchal-Malkajgiri", "Mulugu", "Nagarkurnool", "Nalgonda", "Narayanpet", "Nirmal", "Nizamabad", "Peddapalli", "Rajanna Sircilla", "Rangareddy", "Sangareddy", "Siddipet", "Suryapet", "Vikarabad", "Wanaparthy", "Warangal Rural", "Warangal Urban", "Yadadri Bhuvanagiri"],
            "Tripura": ["Dhalai", "Gomati", "Khowai", "North Tripura", "Sepahijala", "South Tripura", "Unakoti", "West Tripura"],
            "Uttar Pradesh": ["Agra", "Aligarh", "Prayagraj", "Ambedkar Nagar", "Amethi", "Amroha", "Auraiya", "Azamgarh", "Baghpat", "Bahraich", "Ballia", "Balrampur", "Banda", "Barabanki", "Bareilly", "Basti", "Bhadohi", "Bijnor", "Badaun", "Bulandshahr", "Chandauli", "Chitrakoot", "Deoria", "Etah", "Etawah", "Ayodhya", "Farrukhabad", "Fatehpur", "Firozabad", "Gautam Buddha Nagar", "Ghaziabad", "Ghazipur", "Gonda", "Gorakhpur", "Hamirpur", "Hapur", "Hardoi", "Hathras", "Jalaun", "Jaunpur", "Jhansi", "Kannauj", "Kanpur Dehat", "Kanpur Nagar", "Kasganj", "Kaushambi", "Kushinagar", "Lakhimpur Kheri", "Lalitpur", "Lucknow", "Maharajganj", "Mahoba", "Mainpuri", "Mathura", "Mau", "Meerut", "Mirzapur", "Moradabad", "Muzaffarnagar", "Pilibhit", "Pratapgarh", "Rae Bareli", "Rampur", "Saharanpur", "Sambhal", "Sant Kabir Nagar", "Shahjahanpur", "Shamli", "Shravasti", "Siddharthnagar", "Sitapur", "Sonbhadra", "Sultanpur", "Unnao", "Varanasi"],
            "Uttarakhand": ["Almora", "Bageshwar", "Chamoli", "Champawat", "Dehradun", "Haridwar", "Nainital", "Pauri Garhwal", "Pithoragarh", "Rudraprayag", "Tehri Garhwal", "Udham Singh Nagar", "Uttarkashi"],
            "West Bengal": ["Alipurduar", "Bankura", "Birbhum", "Cooch Behar", "Dakshin Dinajpur", "Darjeeling", "Hooghly", "Howrah", "Jalpaiguri", "Jhargram", "Kalimpong", "Kolkata", "Malda", "Murshidabad", "Nadia", "North 24 Parganas", "Paschim Bardhaman", "Paschim Medinipur", "Purba Bardhaman", "Purba Medinipur", "Purulia", "South 24 Parganas", "Uttar Dinajpur"]
         };

        const stateSelect = getEl('gov-state');
        const districtSelect = getEl('gov-district');

        // Safety Check: Ensure dropdowns exist before adding listeners/options
         if(stateSelect && districtSelect) {
             // Clear existing options before repopulating (important if module is re-rendered)
             stateSelect.innerHTML = '<option value="">Select State</option>'; // Add a default empty value option
             districtSelect.innerHTML = '<option>Select District</option>';

             Object.keys(indianStates).sort().forEach(stateName => { // Sort states alphabetically
                 const option = document.createElement('option');
                 option.value = stateName;
                 option.textContent = stateName;
                 stateSelect.appendChild(option);
             });

             const populateDistricts = () => {
                 const selectedState = stateSelect.value;
                 districtSelect.innerHTML = '<option>Select District</option>'; // Reset districts
                 districtSelect.disabled = true; // Disable until state is selected properly
                 if (selectedState && indianStates[selectedState]) { // Check selectedState is not empty
                     indianStates[selectedState].sort().forEach(districtName => { // Sort districts
                         const option = document.createElement('option');
                         option.value = districtName;
                         option.textContent = districtName;
                         districtSelect.appendChild(option);
                     });
                     districtSelect.disabled = false; // Enable district selection
                 }
             };

             stateSelect.addEventListener('change', populateDistricts);
             // Don't call populateDistricts() initially, wait for user selection.
             districtSelect.disabled = true; // Ensure district is disabled initially
         } else {
             console.error("State or District select element not found for module:", module.id);
         }
    }

    // --- Hospital Connect Logic (Added safety checks) ---
    if (module.id === 'hospitalconnect') {
        const serviceSelect = getEl('hospital-service');
        const appointmentDateGroup = getEl('appointment-date-time-group');
        const emergencyLocationGroup = getEl('emergency-location-group');
        const districtSelect = getEl('gov-district'); // Relies on the element created above
        const hospitalSelect = getEl('hospital-select');

        // Safety Check: Ensure elements exist
        if(serviceSelect && appointmentDateGroup && emergencyLocationGroup && districtSelect && hospitalSelect) {
            const populateHospitals = (district) => {
                hospitalSelect.innerHTML = ''; // Clear previous options
                if (!district || district === 'Select District') {
                     hospitalSelect.disabled = true;
                     hospitalSelect.innerHTML = '<option value="">Please select a district first</option>'; // Add empty value
                     return;
                }
                hospitalSelect.disabled = false;
                const mockHospitals = [ /* ... Keep your mock hospital generation ... */
                    `District Government Hospital, ${district}`, `Apollo Hospital, ${district}`,
                    `Max Healthcare, ${district}`, `Fortis Hospital, ${district}`,
                    `Manipal Hospital, ${district}`, `Care Hospital, ${district}`,
                    `Community Health Centre, ${district}`, `ESI Hospital, ${district}`
                ].sort(); // Sort hospital names
                 hospitalSelect.innerHTML = '<option value="">Select Hospital</option>'; // Add default select option
                mockHospitals.forEach(hospitalName => {
                    const option = document.createElement('option');
                    option.value = hospitalName;
                    option.textContent = hospitalName;
                    hospitalSelect.appendChild(option);
                });
            };

            // Ensure listener is added only if districtSelect exists
            districtSelect.addEventListener('change', () => populateHospitals(districtSelect.value));
            hospitalSelect.disabled = true; // Ensure disabled initially

            const toggleVisibility = () => {
                const selectedService = serviceSelect.value;
                appointmentDateGroup.classList.toggle('hidden', selectedService !== 'Appointment Booking');
                emergencyLocationGroup.classList.toggle('hidden', selectedService !== 'Ambulance Request');
            };
            serviceSelect.addEventListener('change', toggleVisibility);
            toggleVisibility(); // Initial call
        } else {
            console.error("One or more UI elements for 'hospitalconnect' specific logic are missing.");
        }
    }

    // --- AI-Scribe Mic Logic (Added safety checks) ---
    if (module.id === 'aiscribe' && recognition) {
        const scribeMicButton = getEl('scribe-mic-button');
        const scribeMicLabel = getEl('scribe-mic-label');
        const textInput = getEl('text-input'); // Assumes aiscribe uses 'text-input'

        // Safety Check: Ensure elements exist
        if(scribeMicButton && scribeMicLabel && textInput) {
            scribeMicButton.addEventListener('click', () => {
                 if (state.isRecording) {
                    recognition.stop(); // Will trigger onend
                } else {
                    try {
                        recognition.lang = state.selectedLanguage;
                        recognition.start(); // Will trigger onstart
                    } catch (recogError) {
                         console.error("Error starting speech recognition:", recogError);
                         // Optionally display an error to the user
                         state.isRecording = false; // Ensure state is correct
                         scribeMicButton.classList.remove('recording');
                         scribeMicLabel.textContent = 'Start Scribing';
                    }
                }
            });

            // Keep original handlers safe if recognition object is reused elsewhere
             const originalOnStart = recognition.onstart;
             const originalOnEnd = recognition.onend;
             const originalOnError = recognition.onerror;
             const originalOnResult = recognition.onresult;

            recognition.onstart = () => {
                 console.log("Recognition started for module:", state.activeModule);
                 if(state.activeModule === 'aiscribe') {
                     scribeMicButton.classList.add('recording');
                     scribeMicLabel.textContent = 'Listening...';
                     state.isRecording = true;
                 } else if (originalOnStart) {
                      originalOnStart.call(recognition); // Call original if exists and not aiscribe
                 }
            };
            recognition.onend = () => {
                console.log("Recognition ended for module:", state.activeModule);
                 if(state.activeModule === 'aiscribe') {
                    scribeMicButton.classList.remove('recording');
                    scribeMicLabel.textContent = 'Start Scribing';
                    state.isRecording = false;
                 } else if (originalOnEnd) {
                     originalOnEnd.call(recognition); // Call original if exists and not aiscribe
                 }
            };
             recognition.onerror = (e) => {
                 console.error('Speech recognition error:', e.error, "for module:", state.activeModule);
                 if(state.activeModule === 'aiscribe') {
                    scribeMicButton.classList.remove('recording');
                    scribeMicLabel.textContent = 'Start Scribing';
                    state.isRecording = false;
                     // Display error? e.g., resultDiv.innerHTML = `<p class="text-red-400">Mic error: ${e.error}</p>`;
                 } else if (originalOnError) {
                    originalOnError.call(recognition, e); // Call original if exists and not aiscribe
                 }
             };
            recognition.onresult = (event) => {
                console.log("Recognition result for module:", state.activeModule);
                 if(state.activeModule === 'aiscribe') {
                     let transcript = '';
                     for (let i = event.resultIndex; i < event.results.length; ++i) {
                         if (event.results[i].isFinal) {
                            transcript += event.results[i][0].transcript;
                         }
                     }
                     if (transcript) {
                        textInput.value = transcript; // Update the text area
                        // Maybe don't auto-submit? Let user review first.
                        // const submitButton = getEl('submit-aiscribe');
                        // if (submitButton) submitButton.click();
                     }
                 } else if (originalOnResult) {
                     originalOnResult.call(recognition, event); // Call original if exists and not aiscribe
                 }
            };
        } else {
            console.error("One or more UI elements for 'aiscribe' logic are missing.");
        }
    }

    // --- Starter Button Logic (Added safety checks) ---
    const starterModules = ['genopredict', 'medsentry', 'cogni', 'mindwell'];
    if (starterModules.includes(module.id)) {
        const startersContainer = getEl(`${module.id}-starters`);
        // Use the correct input ID based on the module
        const inputId = (module.id === 'cogni' || module.id === 'mindwell') ? 'notes-input' : 'text-input';
        const textInput = getEl(inputId);

        // Safety Check: Ensure elements exist
        if (startersContainer && textInput) {
            startersContainer.addEventListener('click', (e) => {
                // Ensure the click is directly on a button with the class
                if (e.target.tagName === 'BUTTON' && e.target.classList.contains('starter-btn')) {
                    const starterText = e.target.textContent;

                    if (module.id === 'medsentry') {
                         // Ensure textInput is the correct element for medsentry
                         const medTextInput = getEl('text-input');
                         const goalSelect = getEl('medsentry-goal');
                         if (!medTextInput || !goalSelect) {
                            console.error("Medsentry input/goal element missing for starter button.");
                            return;
                         }

                         if (starterText.includes(' with ')) {
                            const drugs = starterText.replace('Can I take ', '').replace('?', '').split(' with ');
                            medTextInput.value = drugs.join('\n');
                            goalSelect.value = 'Check for potential drug interactions';
                        } else if (starterText.includes('side effects')) {
                            const drug = starterText.replace('What are the side effects of ', '').replace('?', '');
                            medTextInput.value = drug;
                            goalSelect.value = 'List common side effects for a medication';
                        } else if (starterText.includes('generic')) {
                             const drug = starterText.replace('Is there a generic for ', '').replace('?', '');
                            medTextInput.value = drug;
                            goalSelect.value = 'Find potential cheaper alternatives (generics)';
                        } else {
                             medTextInput.value = starterText; // Default behavior if needed
                        }
                         medTextInput.focus(); // Focus the correct input
                    } else {
                         // For other modules (genopredict, cogni, mindwell)
                         textInput.value = starterText; // Use the determined input element
                         textInput.focus();
                    }
                }
            });
        } else {
             console.warn(`Starter container ('${module.id}-starters') or text input ('${inputId}') not found for module: ${module.id}`);
        }
    }
}; // End of setupModuleEventListeners function

        const callGeminiAPI = async (systemPrompt, textInput, resultDisplay, type) => {
            resultDisplay.innerHTML = `<div class="loader"></div><p class="mt-4">${getTranslation('analysis_loading')}</p>`;
            
            const apiKey = "AIzaSyCbPOQM8vN7pou3lupqEd-1MfTFGnA61UM";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
            
            let parts = [];
            if (textInput) {
                parts.push({ text: textInput });
            }

            if ((type === 'image' || type === 'audio' || type === 'multi') && state.uploadedFiles.length > 0) {
                 if (parts.length === 0) {
                    parts.push({ text: `Please analyze the attached file(s).` });
                }
                parts.push(...state.uploadedFiles);
            }
            
            if (parts.length === 0) {
                resultDisplay.innerHTML = `<p class="text-red-400">Please provide some input for analysis.</p>`;
                return;
            }

            const payload = {
                contents: [{ parts }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
            };

            try {
                const response = await fetchWithRetry(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                
                const candidate = result.candidates?.[0];
                const text = candidate?.content?.parts?.[0]?.text;

                if (text) {
                    const cleanedText = text.replace(/(\*+|#+)/g, '');
                    resultDisplay.innerHTML = `
                    <div class="text-left w-full">${cleanedText.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>')}</div>
                    <button class="speak-btn mt-4" data-speak-text="${cleanedText.replace(/"/g, '&quot;')}">
                        <svg class="speak-icon h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
                        <div class="speak-loader"></div>
                    </button>
                `;
                } else { throw new Error("Invalid AI response."); }
            } catch (error) {
                console.error("Gemini API Error:", error);
                resultDisplay.innerHTML = `<p class="text-red-400">${getTranslation('analysis_error')}</p>`;
            }
        };

        const handleFileUpload = (files, previewContainer, type) => {
            state.uploadedFiles = []; // Reset for new uploads
            previewContainer.innerHTML = '';
            
            Array.from(files).forEach(file => {
                if ((type === 'image' && !file.type.startsWith('image/')) || (type === 'audio' && !file.type.startsWith('audio/'))) {
                    alert(getTranslation(type === 'image' ? 'upload_invalid_file' : 'drop_invalid_file')('image/audio'));
                    return;
                }
                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64Data = e.target.result.split(',')[1];
                    state.uploadedFiles.push({ inlineData: { mimeType: file.type, data: base64Data } });

                    if(type === 'image') {
                        const img = document.createElement('img');
                        img.src = e.target.result;
                        img.className = 'w-full h-24 object-cover rounded-lg';
                        previewContainer.appendChild(img);
                    } else if (type === 'audio') {
                        previewContainer.innerHTML = ''; // Ensure only one audio preview at a time
                        const p = document.createElement('p');
                        p.textContent = `File ready: ${file.name}`;
                        p.className = 'text-gray-300';
                        const audioEl = document.createElement('audio');
                        audioEl.src = e.target.result;
                        audioEl.controls = true;
                        audioEl.className = 'w-full mt-2';
                        
                        const previewWrapper = document.createElement('div');
                        previewWrapper.appendChild(p);
                        previewWrapper.appendChild(audioEl);
                        previewContainer.appendChild(previewWrapper);
                    }
                };
                reader.onerror = () => alert(getTranslation('file_read_error'));
                reader.readAsDataURL(file);
            });
        };

        const displayChatMessage = (message, container) => {
            const cleanedText = message.text.replace(/[<>]/g, (match) => match === '<' ? '&lt;' : '&gt;');
            if(message.sender === 'user') {
                const bubble = document.createElement('div');
                bubble.className = 'p-3 mb-2 max-w-xs md:max-w-md break-words animate-fade-in-up chat-bubble-user';
                bubble.textContent = cleanedText;
                container.appendChild(bubble);
            } else if (message.sender === 'ai') {
                const bubbleContainer = document.createElement('div');
                bubbleContainer.className = 'chat-bubble-ai-container animate-fade-in-up';
                bubbleContainer.innerHTML = `
                    <div class="chat-bubble-ai p-3 mb-2 max-w-xs md:max-w-md break-words">${cleanedText}</div>
                    <button class="speak-btn" data-speak-text="${cleanedText.replace(/"/g, '&quot;')}">
                        <svg class="speak-icon h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
                        <div class="speak-loader"></div>
                    </button>
                `;
                container.appendChild(bubbleContainer);
            }
            container.scrollTop = container.scrollHeight;
        }

        async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
            let lastError;
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await fetch(url, options);
                    if (response.ok) {
                        return response;
                    }
                    lastError = new Error(`API request failed with status ${response.status}`);
                } catch (error) {
                    lastError = error;
                }
                // Don't wait after the last attempt
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
                }
            }
            // If the loop completes without returning, all retries have failed.
            throw lastError || new Error("API request failed after all retries.");
        }

        // --- Three.js Background Animation ---
        function initThreeJS() {
            const canvas = getEl('threejs-canvas');
            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.z = 50;
            renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);

            // Particles
            const particlesGeometry = new THREE.BufferGeometry();
            const particlesCnt = 5000;
            const posArray = new Float32Array(particlesCnt * 3);
            for (let i = 0; i < particlesCnt * 3; i++) {
                posArray[i] = (Math.random() - 0.5) * (Math.random() * 5) * 200;
            }
            particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
            const particlesMaterial = new THREE.PointsMaterial({ size: 0.02, color: 0xa78bfa, blending: THREE.AdditiveBlending });
            particles = new THREE.Points(particlesGeometry, particlesMaterial);
            scene.add(particles);

            // DNA Helix
            const dnaMaterial = new THREE.PointsMaterial({ size: 0.2, color: 0x6366f1, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.7 });
            const dnaGroup = new THREE.Group();
            const numPoints = 200;
            const radius = 5;
            const height = 60;
            for (let i = 0; i < numPoints; i++) {
                const angle = (i / numPoints) * Math.PI * 10;
                const y = (i / numPoints) * height - height / 2;
                const x1 = Math.cos(angle) * radius;
                const z1 = Math.sin(angle) * radius;
                const x2 = Math.cos(angle + Math.PI) * radius;
                const z2 = Math.sin(angle + Math.PI) * radius;
                
                const geometry1 = new THREE.SphereGeometry(0.2, 8, 8);
                const point1 = new THREE.Mesh(geometry1, dnaMaterial);
                point1.position.set(x1, y, z1);
                dnaGroup.add(point1);

                const geometry2 = new THREE.SphereGeometry(0.2, 8, 8);
                const point2 = new THREE.Mesh(geometry2, dnaMaterial);
                point2.position.set(x2, y, z2);
                dnaGroup.add(point2);
            }
            dna = dnaGroup;
            scene.add(dna);
            
            // Central Orb
            const orbGeometry = new THREE.IcosahedronGeometry(10, 5);
            const orbMaterial = new THREE.MeshBasicMaterial({ color: 0x6366f1, wireframe: true });
            orb = new THREE.Mesh(orbGeometry, orbMaterial);
            orb.material.opacity = 0.1;
            orb.material.transparent = true;
            scene.add(orb);
        }

        const animate = () => {
            requestAnimationFrame(animate);
            if (particles) {
                particles.rotation.y += 0.0001;
            }
            if(dna) {
                dna.rotation.y += 0.001;
            }
            if(orb) {
                orb.rotation.y += 0.0005;
                orb.rotation.x += 0.0005;
            }
            if (camera && scene) {
                camera.position.x += (mouseX - camera.position.x) * 0.01;
                camera.position.y += (-mouseY - camera.position.y) * 0.01;
                camera.lookAt(scene.position);
                renderer.render(scene, camera);
            }
        };
        
        window.addEventListener('DOMContentLoaded', () => {
            initializeAppAndAuth();
            initThreeJS();
            animate();

            const langSelect = getEl('language-select');
            const dashboardLangSelect = getEl('dashboard-language-select');
            
            langSelect.addEventListener('change', (e) => {
                setLanguage(e.target.value);
                dashboardLangSelect.value = e.target.value;
            });
            dashboardLangSelect.addEventListener('change', (e) => {
                setLanguage(e.target.value);
                langSelect.value = e.target.value;
            });

            getEl('login-button').addEventListener('click', () => handleAuthentication(true));
            getEl('signup-button').addEventListener('click', () => handleAuthentication(false));
            getEl('anonymous-button').addEventListener('click', () => {
                getEl('auth-forms-container').classList.add('hidden');
                getEl('modal-proceed-button').classList.remove('hidden');
                getEl('anonymous-button').classList.add('hidden');
                userId = `anon-${crypto.randomUUID()}`;
                getEl('user-id-display').textContent = `Anonymous`;
            });
             getEl('logout-button').addEventListener('click', () => {
                signOut(auth);
                // After sign out, the onAuthStateChanged will trigger the UI update.
            });

            getEl('modal-proceed-button').addEventListener('click', () => {
                welcomeAuthModal.classList.add('opacity-0', 'pointer-events-none');
                appWrapper.classList.remove('hidden');
                setTimeout(() => {
                    appWrapper.classList.remove('opacity-0');
                    getEl('sidebar-modules').classList.remove('-translate-x-full');
                    getEl('header-content').classList.remove('-translate-y-full');
                    arogyaAssistantToggle.classList.remove('scale-0');
                    state.isSidebarOpen = true;
                }, 600);
            });

            getEl('toggle-sidebar-button').addEventListener('click', () => {
                getEl('sidebar-modules').classList.toggle('-translate-x-full');
                state.isSidebarOpen = !state.isSidebarOpen;
            });

            getEl('arogya-assistant-toggle').addEventListener('click', () => {
                arogyaAssistantPanel.classList.remove('translate-x-full');
                arogyaAssistantToggle.classList.add('scale-0');
            });
            getEl('close-assistant-panel').addEventListener('click', () => {
                arogyaAssistantPanel.classList.add('translate-x-full');
                arogyaAssistantToggle.classList.remove('scale-0');
            });
            
            const handleChatInput = async () => {
                 const text = chatInput.value.trim();
                 if (!text) return;
                 displayChatMessage({ sender: 'user', text }, chatWindow);
                 chatInput.value = '';

                // Simple Gemini call for chat
                 const systemPrompt = "You are Arogya Co-pilot, a friendly and helpful AI health assistant. Keep your responses concise and clear. Your response language should be " + state.selectedLanguage;
                 const textResponse = await callGeminiAPIChat(systemPrompt, text);
                 displayChatMessage({ sender: 'ai', text: textResponse }, chatWindow);
            };

            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleChatInput();
            });

             if(recognition) {
                const micButton = getEl('mic-button');
                micButton.addEventListener('click', () => {
                    if (state.isRecording) {
                        recognition.stop();
                        state.isRecording = false;
                    } else {
                        recognition.lang = state.selectedLanguage;
                        recognition.start();
                        state.isRecording = true;
                    }
                });
                recognition.onstart = () => micButton.classList.add('recording');
                recognition.onend = () => { micButton.classList.remove('recording'); state.isRecording = false; };
                recognition.onerror = (e) => { console.error('Speech recognition error:', e.error); micButton.classList.remove('recording'); state.isRecording = false; };
                recognition.onresult = (event) => {
                    const transcript = event.results[0][0].transcript;
                    chatInput.value = transcript;
                    handleChatInput();
                };
            }
            
            document.body.addEventListener('click', (e) => {
                if (e.target.closest('.speak-btn')) {
                    const btn = e.target.closest('.speak-btn');
                    const textToSpeak = btn.dataset.speakText;
                    speak(textToSpeak, btn);
                }
            });
            
            // Set initial language and populate modules
            setLanguage(langSelect.value);
            
            // Mouse move for threejs
            document.addEventListener('mousemove', (e) => {
                mouseX = (e.clientX - window.innerWidth / 2) / 100;
                mouseY = (e.clientY - window.innerHeight / 2) / 100;
            });

            window.addEventListener('resize', () => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            });
        });

        // Simplified Gemini call for chat
        const callGeminiAPIChat = async (systemPrompt, textInput) => {
            const apiKey = "AIzaSyCbPOQM8vN7pou3lupqEd-1MfTFGnA61UM";;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
            const payload = {
                contents: [{ parts: [{ text: textInput }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
            };
            try {
                const response = await fetchWithRetry(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                return result.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't process that.";
            } catch (error) {
                console.error("Chat API Error:", error);
                return "An error occurred. Please try again.";
            }
        };

        async function loadEmergencyData(state, district, container) {
            container.innerHTML = `
                <div class="w-full text-left grid grid-cols-1 lg:grid-cols-2 gap-8 mt-6 animate-fade-in-up">
                    <div>
                        <h2 class="text-xl font-bold text-gray-100 mb-4">Immediate Precautions</h2>
                        <div id="sos-first-aid-steps" class="space-y-3">
                            <div class="flex items-center text-indigo-400"><div class="w-6 h-6 border-2 border-t-transparent border-indigo-400 rounded-full spinner"></div><p class="ml-2">Loading advice...</p></div>
                        </div>
                    </div>
                    <div>
                        <h2 class="text-xl font-bold text-gray-100 mb-4">Nearby Hospitals in ${district}</h2>
                        <div id="sos-nearby-hospitals" class="space-y-4">
                             <div class="flex items-center text-indigo-400"><div class="w-6 h-6 border-2 border-t-transparent border-indigo-400 rounded-full spinner"></div><p class="ml-2">Finding hospitals...</p></div>
                        </div>
                    </div>
                </div>
            `;
            
            const firstAidStepsContainer = getEl('sos-first-aid-steps');
            const nearbyHospitalsContainer = getEl('sos-nearby-hospitals');
            
            try {
                // Fetch First Aid Steps
                const apiKey = "AIzaSyCbPOQM8vN7pou3lupqEd-1MfTFGnA61UM";; 
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
                const prompt = `Provide a numbered list of the 5 most critical first aid steps for a generic traffic accident scenario in ${district}, ${state}, India. The steps should be concise and easy to understand for a layperson. Focus on the DRSABCD action plan (Danger, Response, Send for help, Airway, Breathing, CPR, Defibrillation), but simplify it. The response must be a JSON object with a key 'steps', and the value should be an array of strings, where each string is one step. For 'Send for help', include Indian emergency numbers like 102/108. The user's preferred language is ${state.selectedLanguage}. Provide the steps in that language.`;

                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "OBJECT",
                            properties: { "steps": { type: "ARRAY", items: { type: "STRING" }} },
                            required: ["steps"]
                        }
                    }
                };
                
                const response = await fetchWithRetry(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const result = await response.json();
                const data = JSON.parse(result.candidates[0].content.parts[0].text);
                
                // Display First Aid
                firstAidStepsContainer.innerHTML = '';
                data.steps.forEach((step, index) => {
                    const stepEl = document.createElement('div');
                    stepEl.className = 'flex items-start gap-3 p-3 bg-gray-900/50 rounded-lg';
                    stepEl.innerHTML = `
                        <div class="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white font-bold text-sm rounded-full flex items-center justify-center">${index + 1}</div>
                        <p class="text-gray-300 text-sm">${step}</p>
                    `;
                    firstAidStepsContainer.appendChild(stepEl);
                });
                
                // Display Hospitals
                const hospitals = [
                    { name: `District Hospital, ${district}`, distance: '2.5 km', beds: Math.floor(Math.random() * 15) },
                    { name: `St. Mary's Medical Center, ${district}`, distance: '4.1 km', beds: Math.floor(Math.random() * 5) },
                    { name: `Apollo Clinic, ${district}`, distance: '5.8 km', beds: Math.floor(Math.random() * 25) },
                    { name: `Community Care Clinic, ${district}`, distance: '7.2 km', beds: 0 }
                ];

                nearbyHospitalsContainer.innerHTML = '';
                hospitals.forEach(hospital => {
                    const isBedsAvailable = hospital.beds > 0;
                    const hospitalEl = document.createElement('div');
                    hospitalEl.className = 'p-4 rounded-lg border border-gray-700 bg-gray-900/50 flex justify-between items-center';
                    hospitalEl.innerHTML = `
                        <div>
                            <p class="font-semibold text-gray-100">${hospital.name}</p>
                            <p class="text-sm text-gray-400">${hospital.distance} away</p>
                        </div>
                        <div class="text-center">
                             <span class="font-bold text-lg ${isBedsAvailable ? 'text-green-400' : 'text-red-400'}">${hospital.beds}</span>
                             <p class="text-xs text-gray-500">Beds Free</p>
                        </div>
                    `;
                    nearbyHospitalsContainer.appendChild(hospitalEl);
                });
                
            } catch (error) {
                console.error("Emergency SOS error:", error);
                firstAidStepsContainer.innerHTML = `<p class="text-red-400">Could not load first aid advice.</p>`;
                nearbyHospitalsContainer.innerHTML = `<p class="text-red-400">Could not find nearby hospitals.</p>`;
            }

        }





