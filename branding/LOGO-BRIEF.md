# Ultraforce — Logo Brief & Generation Prompts

Wordmark-first logo for **Ultraforce**, a Salesforce SOQL / Apex / debug-log
desktop tool. Brand accent: **orange `#F54E00`**; ink: **charcoal `#1E1E2E`**.

## Design principles (from research)
- Lead the prompt with the brand name **in quotes** so the model renders the
  real letters instead of inventing glyphs.
- Say **"wordmark logo"** explicitly; keep it **text-primary** with one glyph twist.
- **≤ 3 colors**; end every prompt with output format (flat vector / white bg).
- 30–60 words, written as a brief, not a keyword list.
- For text fidelity, **Ideogram 3.0** is the most reliable model; gpt-image / DALL·E are fine for exploration.

## Three concepts (each ties to Salesforce + the tool's purpose)

### 1 — Cloud-O (Salesforce nod)
> A modern wordmark logo reading "Ultraforce" on a single line, geometric sans-serif, heavy weight, lowercase. The letter "o" in "force" is redrawn as a simple rounded cloud silhouette, a subtle nod to Salesforce. Two colors only: warm orange (#F54E00) wordmark on a clean white background. Flat vector, crisp edges, generous even letter-spacing, centered, no tagline, high resolution.

### 2 — Run / cursor (query execution)
> A developer-tool wordmark logo reading "ULTRAFORCE" in a clean technical grotesque sans-serif, medium weight, all caps. A solid orange right-pointing run/play triangle is integrated as the counter of the letter "A", and a small terminal cursor block sits immediately after the final "E". Two colors: charcoal (#1E1E2E) letters with one orange (#F54E00) accent, on white. Flat vector, balanced spacing, high resolution.

### 3 — UF monogram + wordmark (app icon)
> A minimal monogram logo: interlocking letters "U" and "F" that together suggest a lightning bolt, paired underneath with a small wordmark "Ultraforce" in a geometric sans-serif. Two colors: orange (#F54E00) monogram and charcoal (#1E1E2E) wordmark on a white background. Flat vector, geometric, symmetrical, app-icon friendly, square 1:1, high resolution.

## How to generate (pick one)
1. **Interactive codex (saves to disk):** run `codex` in a terminal and paste a
   prompt. Images land in `~/.codex/generated_images/<session-id>/ig_*.png`.
   (Headless `codex exec` renders but does **not** persist — confirmed.)
2. **Ideogram** (best text rendering): paste a prompt at ideogram.ai.
3. **Let Claude save PNGs directly:** export `OPENAI_API_KEY` and the
   `gpt-image-2` skill's `generate.js` will write files to `branding/`.

## Sources
- [AI prompts for logo design — AND Academy](https://www.andacademy.com/resources/blog/graphic-design/ai-prompts-for-logo-design/)
- [Best logo design prompts — Promptomania](https://promptomania.com/prompts/logo-prompts)
- [20 best AI prompts for logo design (Midjourney) — Superside](https://www.superside.com/blog/ai-prompts-logo-design)
