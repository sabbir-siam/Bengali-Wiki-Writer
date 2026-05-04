import { useState, useRef, useEffect } from "react";
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
  const [chunks, setChunks] = useState<Array<{
    id: string;
    source: string;
    result: string;
    isTranslating: boolean;
    error: string | null;
    stats: any | null;
    lastLine: string | null;
  }>>([]);
  const [copied, setCopied] = useState(false);
  const [copiedChunkId, setCopiedChunkId] = useState<string | null>(null);
  const [copiedSource, setCopiedSource] = useState(false);

  const editorRefs = useRef<{[key: string]: HTMLDivElement | null}>({});

  const createChunks = (text: string) => {
    if (!text) return [];
    // Target uniform size around 2500 characters
    const targetSize = 2500;
    const paragraphs = text.split(/\n\n+/);
    const finalChunks: string[] = [];
    let currentChunk = "";

    paragraphs.forEach((p) => {
      if ((currentChunk.length + p.length) > (targetSize * 1.2) && currentChunk.length > 0) {
        finalChunks.push(currentChunk);
        currentChunk = p;
      } else {
        currentChunk = currentChunk ? currentChunk + "\n\n" + p : p;
      }
    });
    
    if (currentChunk) finalChunks.push(currentChunk);

    return finalChunks.map((c, i) => ({
      id: `chunk-${i}-${Date.now()}`,
      source: c,
      result: "",
      isTranslating: false,
      error: null,
      stats: null,
      lastLine: null
    }));
  };

  const handleFetch = async () => {
    if (!input.trim()) return;
    setIsFetching(true);
    setError(null);
    setChunks([]);

    try {
      let title = input.trim();
      
      // If it's a Wikipedia URL, extract the title
      if (title.startsWith("http")) {
        try {
          const urlObj = new URL(title);
          // Handle both /wiki/Title and ?title=Title
          const pathParts = urlObj.pathname.split('/');
          title = pathParts[pathParts.length - 1] || title;
          
          if (urlObj.searchParams.has('title')) {
            title = urlObj.searchParams.get('title') || title;
          }
          
          // Decode URL component (e.g. %20 -> space)
          title = decodeURIComponent(title);
        } catch (e) {
          // Fallback to original if URL parsing fails
        }
      }

      // Wikipedia API for wikitext with CORS support (origin=*)
      // Added redirects=1 to handle title changes automatically
      const wikiApiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&titles=${encodeURIComponent(title)}&rvprop=content&format=json&origin=*&redirects=1`;
      
      const response = await fetch(wikiApiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Api-User-Agent': 'WikiTranslatorApp/1.0 (https://ais-dev.cloudrun.app)'
        }
      });

      if (!response.ok) {
        throw new Error(`Wikipedia API returned status ${response.status}`);
      }

      const text = await response.text();
      if (!text || !text.trim()) {
        throw new Error("Wikipedia returned an empty response. Please try again.");
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error("JSON Parse Error. Raw response:", text.substring(0, 500));
        throw new Error("Wikipedia returned invalid data. Please try again with a different article.");
      }
      
      if (!data.query || !data.query.pages) {
        throw new Error("Could not find article. Please check the name or URL.");
      }

      const pages = data.query.pages;
      const pageId = Object.keys(pages)[0];
      
      if (pageId === "-1") {
        throw new Error("Article not found. Please ensure the Wikipedia article exists.");
      }

      const revisions = pages[pageId].revisions;
      if (!revisions || revisions.length === 0) {
        throw new Error("Could not retrieve article content. The page might be empty or protected.");
      }

      // Wikipedia content can be in 'content' or '*' depending on API version/params
      const wikitext = revisions[0].content || revisions[0]['*'];
      
      if (wikitext === undefined) {
        throw new Error("Article content structure not recognized. Please try again.");
      }

      const newChunks = createChunks(wikitext);
      if (newChunks.length === 0) {
        throw new Error("The article has no content to translate.");
      }
      setChunks(newChunks);
    } catch (err: any) {
      console.error("Fetch error:", err);
      setError(err.message || "Failed to fetch. This may be a network error or the article doesn't exist.");
    } finally {
      setIsFetching(false);
    }
  };

  const translateChunk = async (index: number) => {
    const chunk = chunks[index];
    if (!chunk.source.trim()) return;

    setChunks(prev => prev.map((c, i) => i === index ? { ...c, isTranslating: true, error: null } : c));

    try {
      // Use process.env.GEMINI_API_KEY which is defined in vite.config.ts
      const apiKey = process.env.GEMINI_API_KEY;
      
      if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
        throw new Error("API Key missing. Please set VITE_GEMINI_API_KEY in your hosting provider's (e.g. Netlify/Cloudflare) settings.");
      }

      const countImages = (str: string) => {
        const matches = str.match(/(?:\[\[(?:File|Image):|\|\s*(?:image|logo|map|skyline|signature|image_name)\s*=)/gi) || [];
        return matches.length;
      };
      
      const imageMatches = chunk.source.match(/(?:\[\[(?:File|Image):|\|\s*(?:image|logo|map|skyline|signature|image_name)\s*=)\s*([^|\]\n}]+)/gi) || [];
      const imageFiles = imageMatches.map(m => m.replace(/^(?:\[\[(?:File|Image):|\|\s*(?:image|logo|map|skyline|signature|image_name)\s*=)/i, '').trim());
      const sourceImagesCount = imageFiles.length;

      const systemInstruction = `You are an elite Bengali Wikipedia editor and historian. 
TASK: High-fidelity, word-for-word translation of Wikipedia wikitext.

STRICT CRITICAL RULES:
1. MECHANICAL IMAGE PRESERVATION: You MUST copy every [[File:...]] and [[Image:...]] tag and template image parameters (e.g. image=, logo=) exactly as they appear. 
   - MANDATORY FILES/IMAGES TO INCLUDE: ${imageFiles.join(", ") || "None in this section"}
   - Total expected images/parameters in this section: ${sourceImagesCount}
2. NO SUMMARIZATION: Translate every single sentence. If the source has 10 sentences, your output must have 10 (or more) Bengali sentences.
3. TAG INTEGRITY: Do not modify <ref> tags, {{templates}}, or categories.
4. TONE: Senior journalistic Bengali.

${INSTRUCTIONS}`;

      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `TRANSLATE THIS WIKITEXT SECTION. 
- PRESERVE ALL ${sourceImagesCount} IMAGES.
- DO NOT SKIP ANY CONTENT.
- EXPAND NATURALLY IN BENGALI.

SOURCE:
${chunk.source}`,
        config: {
          systemInstruction,
          temperature: 0.1,
        }
      });

      let text = response.text || "";
      
      text = text.replace(/^```wikitext\n/, "").replace(/^```\n?/, "").replace(/\n?```$/, "");

      const countWords = (str: any) => {
        if (typeof str !== 'string') return 0;
        return str.trim().split(/\s+/).filter(Boolean).length;
      };
      
      // Highlight heuristic
      const sourceLines = chunk.source.split('\n');
      const refs = chunk.source.match(/<ref[^>]*>.*?<\/ref>|{{[^}]+}}/g) || [];
      let lastMatch = null;
      for (let i = refs.length - 1; i >= 0; i--) {
        if (text.includes(refs[i])) {
          const lIdx = sourceLines.findIndex(l => l.includes(refs[i]));
          if (lIdx !== -1) { lastMatch = sourceLines[lIdx].trim(); break; }
        }
      }

      const chunkStats = {
        sourceImages: sourceImagesCount,
        resultImages: countImages(text),
        sourceWords: countWords(chunk.source),
        resultWords: countWords(text),
      };

      setChunks(prev => prev.map((c, i) => i === index ? { 
        ...c, 
        result: text, 
        isTranslating: false, 
        stats: chunkStats,
        lastLine: lastMatch 
      } : c));

    } catch (err: any) {
      console.error("Translation error details:", err);
      // Fallback for common error types
      let errorMsg = err.message || "Unknown translation error";
      if (errorMsg.includes("API key not valid")) {
        errorMsg = "Invalid API Key. Please check your settings.";
      } else if (errorMsg.includes("User location is not supported")) {
        errorMsg = "Gemini is not available in your region.";
      }
      setChunks(prev => prev.map((c, i) => i === index ? { ...c, isTranslating: false, error: errorMsg } : c));
    }
  };

  const copyFullResult = () => {
    const fullText = chunks.map(c => c.result || "").join("\n\n");
    if (!fullText.trim()) return;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyChunkResult = (id: string, text: string) => {
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedChunkId(id);
    setTimeout(() => setCopiedChunkId(null), 2000);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <Languages size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-neutral-800 font-display">Bengali Wiki Writer</h1>
              <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-[0.2em]">Wikipedia Editor Pro</p>
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

            {chunks.some(c => c.result) && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-4"
              >
                <h3 className="font-bold text-neutral-800 flex items-center gap-2 border-b border-neutral-100 pb-2 text-sm">
                  <Check size={18} className="text-emerald-600" />
                  Translation Progress
                </h3>
                
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-500 font-medium">Sections Done:</span>
                    <span className="font-bold text-emerald-600">
                      {chunks.filter(c => c.result).length} / {chunks.length}
                    </span>
                  </div>
                  
                  <div className="w-full bg-neutral-100 h-1.5 rounded-full overflow-hidden">
                    <motion.div 
                      className="bg-emerald-500 h-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(chunks.filter(c => c.result).length / chunks.length) * 100}%` }}
                    />
                  </div>

                  <p className="text-[10px] text-neutral-400 font-medium leading-relaxed">
                    Translate all sections to complete the article. You can copy the full result at the top of the editor.
                  </p>
                </div>
              </motion.div>
            )}
          </div>

          {/* Right Column: Chunked Editor View */}
          <div className="lg:col-span-9 space-y-6">
            {chunks.length > 0 && (
              <div className="sticky top-[72px] z-40 bg-white p-4 rounded-xl border border-emerald-100 shadow-sm flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-emerald-800 uppercase tracking-widest">Article Sections ({chunks.length})</h2>
                  <p className="text-[10px] text-neutral-500 font-bold">Translate parts individually for total accuracy</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={copyFullResult}
                    disabled={!chunks.some(c => c.result)}
                    className="bg-neutral-900 hover:bg-neutral-800 disabled:opacity-20 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 active:scale-95"
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    {copied ? "Copied!" : "Copy Full Article"}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-8">
              {chunks.length === 0 ? (
                <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm min-h-[600px] flex flex-col items-center justify-center p-12 text-center">
                  <div className="w-20 h-20 bg-neutral-50 rounded-3xl flex items-center justify-center text-neutral-300 mb-6">
                    <BookOpen size={40} />
                  </div>
                  <h2 className="text-xl font-bold text-neutral-800 mb-2">Ready to start?</h2>
                  <p className="text-neutral-500 max-w-sm mb-8">
                    Enter an English Wikipedia title or URL above. We will split the article into sections for easier translation.
                  </p>
                  <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                     <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 text-left">
                        <PenTool size={16} className="text-emerald-600 mb-2" />
                        <h4 className="text-xs font-bold text-emerald-900 uppercase mb-1">Edit First</h4>
                        <p className="text-[10px] text-emerald-700 leading-relaxed">Refine or delete parts of the English source if needed.</p>
                     </div>
                     <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 text-left">
                        <Languages size={16} className="text-amber-600 mb-2" />
                        <h4 className="text-xs font-bold text-amber-900 uppercase mb-1">Rewrite</h4>
                        <p className="text-[10px] text-amber-700 leading-relaxed">Each section gets a dedicated AI rewrite pass.</p>
                     </div>
                  </div>
                </div>
              ) : (
                chunks.map((chunk, idx) => (
                  <motion.div 
                    key={chunk.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col"
                  >
                    {/* Chunk Header */}
                    <div className="bg-neutral-50 border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                         <span className="bg-neutral-900 text-white w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold">
                           {idx + 1}
                         </span>
                         <div>
                            <h4 className="text-xs font-bold text-neutral-800 uppercase tracking-widest">Section {idx + 1}</h4>
                            <p className="text-[10px] text-neutral-500 font-bold uppercase">{chunk.source.length} characters</p>
                         </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {chunk.error && (
                          <div className="flex flex-col items-end mr-3">
                            <div className="flex items-center gap-1 text-red-600 text-[10px] font-bold">
                              <AlertCircle size={12} />
                              Error
                            </div>
                            <span className="text-[9px] text-red-500 font-medium max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap" title={chunk.error}>
                              {chunk.error}
                            </span>
                          </div>
                        )}
                        <button 
                          onClick={() => translateChunk(idx)}
                          disabled={chunk.isTranslating}
                          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 active:scale-95 shadow-lg shadow-emerald-200/50"
                        >
                          {chunk.isTranslating ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <><Languages size={14} /> Rewrite Section</>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 h-full min-h-[400px]">
                      {/* English Source Area */}
                      <div className="flex flex-col border-r border-neutral-100 bg-neutral-900 overflow-hidden">
                        <div className="bg-neutral-800 text-[9px] text-neutral-400 px-4 py-1.5 flex items-center gap-2 uppercase tracking-[0.2em] font-bold">
                          <PenTool size={10} />
                          Editorial Zone (English)
                        </div>
                        <div 
                          ref={el => {
                            editorRefs.current[chunk.id] = el;
                            if (el && !el.innerText && chunk.source) {
                               el.innerText = chunk.source;
                               // Red highlighting logic for the last line
                               if (chunk.lastLine && chunk.source.includes(chunk.lastLine)) {
                                  const lastIndex = chunk.source.lastIndexOf(chunk.lastLine);
                                  const firstPart = chunk.source.substring(0, lastIndex);
                                  const remainingPart = chunk.source.substring(lastIndex + chunk.lastLine.length);
                                  el.innerHTML = `${firstPart.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] || m))}<span style="color: #ef4444; font-weight: bold; border-bottom: 2px solid #ef4444;">${chunk.lastLine.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] || m))}</span>${remainingPart.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m] || m))}`;
                               }
                            }
                          }}
                          contentEditable
                          onInput={(e) => {
                             const newSource = e.currentTarget.innerText;
                             setChunks(prev => prev.map((c, i) => i === idx ? { ...c, source: newSource } : c));
                          }}
                          spellCheck={false}
                          className="flex-1 p-6 font-mono text-[13px] leading-relaxed text-neutral-300 focus:outline-none overflow-y-auto whitespace-pre-wrap outline-none selection:bg-emerald-500/20"
                        />
                      </div>

                      {/* Bengali Result Area */}
                      <div className="flex flex-col bg-emerald-950/30">
                        <div className="bg-emerald-900/40 text-[9px] text-emerald-100/60 px-4 py-1.5 flex items-center justify-between uppercase tracking-[0.2em] font-bold">
                          <div className="flex items-center gap-2">
                            <FileText size={10} />
                            Bengali Result
                          </div>
                          {chunk.result && (
                            <button 
                              onClick={() => copyChunkResult(chunk.id, chunk.result)}
                              className="text-emerald-300 hover:text-white flex items-center gap-1 transition-colors group/copy"
                            >
                              {copiedChunkId === chunk.id ? <Check size={10} /> : <Copy size={10} />}
                              <span>{copiedChunkId === chunk.id ? "Copied" : "Copy Section"}</span>
                            </button>
                          )}
                        </div>
                        <div className="flex-1 relative">
                          {chunk.isTranslating ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center gap-4">
                               <div className="w-10 h-10 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                               <p className="text-[10px] font-bold uppercase text-emerald-600 tracking-widest animate-pulse">Rewriting Knowledge...</p>
                            </div>
                          ) : chunk.result ? (
                            <textarea 
                              readOnly
                              className="w-full h-full p-6 font-mono text-[13px] leading-relaxed bg-transparent text-emerald-50 focus:outline-none resize-none"
                              value={chunk.result}
                            />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-neutral-400/40 opacity-50 grayscale transition-all group-hover:grayscale-0">
                               <Languages size={40} className="mb-4" />
                               <p className="text-[10px] font-bold uppercase tracking-widest">Click Rewrite</p>
                            </div>
                          )}
                        </div>
                        
                        {chunk.stats && (
                          <div className="bg-emerald-900/10 p-4 border-t border-emerald-100/10 grid grid-cols-2 gap-4">
                            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-tighter">
                               <span className="text-emerald-700/60">Images:</span>
                               <span className={chunk.stats.resultImages === chunk.stats.sourceImages ? "text-emerald-600" : "text-red-500"}>
                                 {chunk.stats.resultImages}/{chunk.stats.sourceImages}
                               </span>
                            </div>
                            <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-tighter">
                               <span className="text-emerald-700/60">Expansion:</span>
                               <span className={(chunk.stats.resultWords / chunk.stats.sourceWords) >= 1.2 ? "text-emerald-600" : "text-amber-500"}>
                                 {(chunk.stats.resultWords / chunk.stats.sourceWords).toFixed(1)}x
                               </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
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
            Developer info- Sabbir Ahamed Siam || CE,CUET
          </p>
        </div>
      </footer>
    </div>
  );
}
