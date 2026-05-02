import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // API routes
  app.post("/api/fetch-wiki", async (req, res) => {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: "Input is required" });

    let url = "";

    // Determine URL based on input type
    if (input.startsWith("http")) {
      if (input.includes("?action=raw")) {
        url = input;
      } else {
        url = input + "?action=raw";
      }
    } else {
      // It's likely an article name
      const formattedName = input.trim().replace(/\s+/g, "_");
      url = `https://en.wikipedia.org/wiki/${formattedName}?action=raw`;
    }

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'BengaliWikiWriter/1.0 (Contact: agent@ais.dev)'
        }
      });
      res.json({ wikitext: response.data, sourceUrl: url });
    } catch (error: any) {
      console.error("Error fetching Wikipedia:", error.message);
      res.status(500).json({ error: "Failed to fetch Wikipedia article. Make sure the name or URL is correct." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
