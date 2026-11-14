import { Injectable, Logger } from '@nestjs/common';

export interface ParsedResumeResult {
  name?: string;
  email?: string;
  phone?: string;
  currentTitle?: string;
  linkedIn?: string;
  portfolio?: string;
  experience?: string;
  skills?: string;
  roles?: string;
  suggestedRoles?: string[];
  locations?: string;
  noticePeriod?: string;
  currentCtc?: string;
  expectedCtc?: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private keys: string[] = [];
  private currentKeyIndex = 0;
  private readonly models = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];

  constructor() {
    this.loadKeys();
  }

  private loadKeys() {
    const raw = process.env.GEMINI_API_KEYS || '';
    this.keys = raw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    this.logger.log(`Loaded ${this.keys.length} Gemini API keys for resume parsing and key rotation`);
  }

  private getNextKey(): { key: string; index: number } {
    if (this.keys.length === 0) {
      throw new Error('No GEMINI_API_KEYS configured in environment.');
    }
    const index = this.currentKeyIndex;
    const key = this.keys[index];
    return { key, index };
  }

  private rotateKey() {
    if (this.keys.length > 0) {
      const prev = this.currentKeyIndex;
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.keys.length;
      this.logger.warn(
        `[Gemini Auto-Rotation] Switched API key from index #${prev + 1} to index #${this.currentKeyIndex + 1} of ${this.keys.length}`,
      );
    }
  }

  async parseResume(
    fileBase64: string,
    mimeType: string = 'application/pdf',
    fileName: string = 'resume.pdf',
  ): Promise<ParsedResumeResult> {
    if (this.keys.length === 0) {
      this.loadKeys();
      if (this.keys.length === 0) {
        throw new Error('GEMINI_API_KEYS environment variable is empty.');
      }
    }

    const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');

    const promptText = `You are an expert AI resume parser for the ApplyBro platform.
Analyze the provided resume document (${fileName}) and extract structured profile information.
Return ONLY a valid JSON object matching this exact schema:
{
  "name": "Candidate's full name",
  "email": "Candidate's email address",
  "phone": "Candidate's phone number",
  "currentTitle": "Candidate's current or target job title (e.g. Frontend Engineer, Full Stack Developer, Data Scientist)",
  "linkedIn": "Candidate's LinkedIn URL (e.g. https://linkedin.com/in/...)",
  "portfolio": "Candidate's GitHub, personal website, or portfolio URL",
  "experience": "Best match from one of: 'Fresher / Entry Level (< 1 year)', '1–3 years', '3–5 years', '5–8 years', '8+ years'",
  "skills": "Comma separated string of top 8 to 15 technical and professional skills (e.g. React, Next.js, TypeScript, Node.js, PostgreSQL)",
  "roles": "Comma separated string of 2 to 4 recommended job roles based on experience",
  "suggestedRoles": ["Array of 6 to 8 personalized job titles tailored specifically to this candidate's resume background, domain, and skills"],
  "locations": "Preferred locations if mentioned, or 'Remote, Bengaluru, Hyderabad'",
  "noticePeriod": "Best match from: 'Immediate Joiner', '15 Days', '30 Days', '60 Days', '90 Days'",
  "currentCtc": "Current salary/CTC if mentioned or empty string",
  "expectedCtc": "Expected salary/CTC if mentioned or empty string"
}
Rules:
- Be accurate and extract real data from the resume.
- If a field is not found in the resume, leave it as an empty string "".
- Return valid JSON only, without markdown backticks or commentary.`;

    const totalAttempts = this.keys.length;
    let lastError: any = null;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      const { key, index } = this.getNextKey();
      const model = this.models[0];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        const parts: any[] = [];

        // Add inline file data for PDF or supported images
        if (mimeType.includes('pdf') || mimeType.includes('image')) {
          parts.push({
            inlineData: {
              mimeType: mimeType.includes('pdf') ? 'application/pdf' : mimeType,
              data: cleanBase64,
            },
          });
        }

        parts.push({ text: promptText });

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        });

        if (response.ok) {
          const data: any = await response.json();
          const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate) {
            this.logger.log(`[Gemini Key #${index + 1}] Successfully parsed resume ${fileName}`);
            try {
              const cleaned = candidate.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
              const parsed = JSON.parse(cleaned);
              if (!Array.isArray(parsed.suggestedRoles) || parsed.suggestedRoles.length === 0) {
                if (parsed.roles) {
                  parsed.suggestedRoles = parsed.roles.split(',').map((s: string) => s.trim()).filter(Boolean);
                }
              }
              return parsed;
            } catch (jsonErr) {
              this.logger.error(`Failed to parse JSON response from Gemini: ${candidate}`);
            }
          }
        }

        const errorBody: any = await response.json().catch(() => ({}));
        const status = response.status;
        this.logger.warn(
          `[Gemini Key #${index + 1}] Request failed with HTTP ${status}: ${errorBody?.error?.message || 'Unknown error'}`,
        );

        // If rate limited, quota exceeded, or service overloaded: rotate to next key
        if (status === 429 || status === 403 || status === 503 || status === 500) {
          this.rotateKey();
          lastError = new Error(`Key #${index + 1} failed: ${errorBody?.error?.message || status}`);
          continue;
        }

        lastError = new Error(`Gemini API returned ${status}: ${errorBody?.error?.message}`);
        this.rotateKey();
      } catch (err: any) {
        this.logger.warn(`[Gemini Key #${index + 1}] Network or fetch error: ${err.message}`);
        lastError = err;
        this.rotateKey();
      }
    }

    throw lastError || new Error('All Gemini API keys failed or exhausted.');
  }
}
