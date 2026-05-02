import { useState, useRef } from "react";
import { 
  Languages, 
  Search, 
  Copy, 
  Check, 
  Loader2, 
  ExternalLink, 
  Info, 
  AlertCircle,
  BookOpen,
  FileText,
  History,
  PenTool
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import { INSTRUCTIONS } from "./constants";

export default function App() {
  const [input, setInput] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceWikitext, setSourceWikitext] = useState("");
  const [bengaliWikitext, setBengaliWikitext] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"source" | "result">("source");

  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleFetch = async () => {
    if (!input.trim()) return;
    setIsFetching(true);
    setError(null);
    setSourceWikitext("");
    setBengaliWikitext("");

    try {
      const response = await fetch("/api/fetch-wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch");
      setSourceWikitext(data.wikitext);
      setActiveTab("source");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsFetching(false);
    }
  };

  const handleTranslate = async () => {
    if (!sourceWikitext) return;
    setIsTranslating(true);
    setError(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured.");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const systemPrompt = `You are a master Bengali Wikipedia editor, an expert translator, and a seasoned Bengali journalist with 20+ years of experience. Your goal is to rewrite the provided English Wikipedia wikitext into a complete, publication-ready Bengali Wikipedia article.

FOLLOW THESE STRICT RULES:
${INSTRUCTIONS}

The output must be ONLY the raw Bengali wikitext. No preamble, no commentary, no markdown code fences.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { role: "user", parts: [{ text: systemPrompt }, { text: `ENGLISH WIKITEXT SOURCE:\n\n${sourceWikitext}` }] }
        ],
        config: {
          temperature: 0.1,
        }
      });

      let text = response.text || "";

      // Clean up if the model accidentally included markdown fences
      text = text.replace(/^```wikitext\n/, "").replace(/^```\n?/, "").replace(/\n?```$/, "");

      setBengaliWikitext(text);
      setActiveTab("result");
    } catch (err: any) {
      console.error("Gemini Error:", err);
      setError(err.message || "Failed to translate with AI.");
    } finally {
      setIsTranslating(false);
    }
  };

  const copyToClipboard = () => {
    if (!bengaliWikitext) return;
    navigator.clipboard.writeText(bengaliWikitext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <Languages size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-neutral-800">Bengali Wiki Writer</h1>
              <p className="text-xs text-neutral-500 font-medium uppercase tracking-widest">Wikipedia Editor Pro</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <a 
              href="https://bn.wikipedia.org" 
              target="_blank" 
              rel="noreferrer"
              className="text-sm font-medium text-neutral-600 hover:text-emerald-600 flex items-center gap-1 transition-colors"
            >
              Bengali Wikipedia <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Search Section */}
        <div className="max-w-3xl mx-auto mb-10">
          <div className="bg-white p-2 rounded-2xl shadow-sm border border-neutral-200 flex items-center gap-2">
            <div className="pl-4 text-neutral-400">
              <Search size={20} />
            </div>
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter English Wikipedia URL or article name..."
              className="flex-1 bg-transparent border-none outline-none py-3 text-lg placeholder:text-neutral-300"
              onKeyDown={(e) => e.key === "Enter" && handleFetch()}
            />
            <button 
              onClick={handleFetch}
              disabled={isFetching || !input.trim()}
              className="bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              {isFetching ? <Loader2 size={18} className="animate-spin" /> : "Fetch Article"}
            </button>
          </div>
          <p className="text-center text-sm text-neutral-400 mt-4">
            Example: <span className="italic">"Black hole"</span> or <span className="italic">"Albert Einstein"</span>
          </p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto mb-8 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl flex items-start gap-3"
          >
            <AlertCircle size={20} className="mt-0.5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </motion.div>
        )}

        {/* Content Area */}
        <div className="grid lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Quick Instructions & Status */}
          <div className="lg:col-span-3 space-y-6 hidden lg:block">
            <div className="bg-white rounded-2xl border border-neutral-200 p-6 flex flex-col gap-4">
              <h3 className="font-bold text-neutral-800 flex items-center gap-2">
                <Info size={18} className="text-emerald-600" />
                Quick Guide
              </h3>
              <ul className="text-sm space-y-3 text-neutral-600">
                <li className="flex gap-2">
                  <span className="w-5 h-5 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                  Fetch any English Wikipedia article.
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                  Generate a publication-ready Bengali version.
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                  Copy and paste into Bengali Wikipedia source editor.
                </li>
              </ul>
            </div>

            <div className="bg-emerald-900 rounded-2xl p-6 text-white overflow-hidden relative">
              <div className="relative z-10">
                <h3 className="font-bold flex items-center gap-2 mb-2">
                  <PenTool size={18} />
                  Journalistic Quality
                </h3>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Our algorithm ensures natural connectors, active voice, and living vocabulary instead of robotic literal translations.
                </p>
              </div>
              <div className="absolute -bottom-6 -right-6 opacity-10 rotate-12">
                <BookOpen size={100} />
              </div>
            </div>
          </div>

          {/* Right Column: Editor / Result View */}
          <div className="lg:col-span-9 space-y-4">
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
              {/* Tabs */}
              <div className="flex items-center justify-between border-b border-neutral-200 px-4">
                <div className="flex">
                  <button 
                    onClick={() => setActiveTab("source")}
                    className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
                      activeTab === "source" 
                        ? "border-emerald-600 text-emerald-600" 
                        : "border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-200"
                    }`}
                  >
                    <History size={16} />
                    English Source
                  </button>
                  <button 
                    onClick={() => setActiveTab("result")}
                    disabled={!bengaliWikitext && !isTranslating}
                    className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 disabled:opacity-20 ${
                      activeTab === "result" 
                        ? "border-emerald-600 text-emerald-600" 
                        : "border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-200"
                    }`}
                  >
                    <FileText size={16} />
                    Bengali Wikitext
                  </button>
                </div>

                <div className="flex items-center gap-2 py-2">
                  {activeTab === "source" && sourceWikitext && (
                    <button 
                      onClick={handleTranslate}
                      disabled={isTranslating}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
                    >
                      {isTranslating ? <Loader2 size={16} className="animate-spin" /> : "Rewrite in Bengali"}
                    </button>
                  )}
                  {activeTab === "result" && bengaliWikitext && (
                    <button 
                      onClick={copyToClipboard}
                      className="bg-neutral-900 hover:bg-neutral-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
                    >
                      {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                      {copied ? "Copied!" : "Copy Wikitext"}
                    </button>
                  )}
                </div>
              </div>

              {/* Editor Pane */}
              <div className="flex-1 relative">
                <AnimatePresence mode="wait">
                  {activeTab === "source" ? (
                    <motion.div 
                      key="source"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full"
                    >
                      {sourceWikitext ? (
                        <textarea 
                          readOnly
                          className="w-full h-[600px] p-6 font-mono text-sm leading-relaxed bg-neutral-900 text-neutral-200 focus:outline-none resize-none"
                          value={sourceWikitext}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-[600px] text-neutral-400 gap-4 bg-neutral-50">
                          <div className="w-16 h-16 rounded-2xl bg-neutral-200 flex items-center justify-center">
                            <BookOpen size={32} />
                          </div>
                          <div className="text-center">
                            <p className="font-semibold">No article loaded</p>
                            <p className="text-sm">Search for an English Wikipedia article above to begin.</p>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="result"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full"
                    >
                      {isTranslating ? (
                        <div className="flex flex-col items-center justify-center h-[600px] text-neutral-400 gap-6 bg-neutral-50">
                          <div className="relative">
                            <div className="w-16 h-16 border-4 border-emerald-100 rounded-full"></div>
                            <div className="w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin absolute top-0"></div>
                          </div>
                          <div className="text-center max-w-sm px-4">
                            <p className="font-semibold text-neutral-800">Processing Knowledge...</p>
                            <p className="text-sm">The AI is rewriting the article using senior journalistic standards and Bengali linguistic nuances. This may take a minute.</p>
                          </div>
                        </div>
                      ) : bengaliWikitext ? (
                        <textarea 
                          ref={textAreaRef}
                          readOnly
                          className="w-full h-[600px] p-6 font-mono text-sm leading-relaxed bg-emerald-950 text-emerald-50 focus:outline-none resize-none"
                          value={bengaliWikitext}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-[600px] text-neutral-400 gap-4 bg-neutral-50">
                          <p>Click "Rewrite in Bengali" to generate content.</p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-12 border-t border-neutral-200 mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-50">
             <Languages size={20} />
             <span className="font-bold text-sm">Bengali Wiki Writer</span>
          </div>
          <p className="text-xs text-neutral-400 max-w-md text-center md:text-right">
            By using this tool, you agree to attribute the source English Wikipedia article when publishing. This tool is designed to assist professional Bengali editors.
          </p>
        </div>
      </footer>
    </div>
  );
}
