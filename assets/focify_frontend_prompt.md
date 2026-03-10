
# FOCify.ME Frontend Design Prompt

Design a modern landing page for **FOCify.ME**, a tool that converts websites into Filecoin-hosted versions using **Filecoin Onchain Cloud (FOC)**.

The design should be inspired by:

- https://filecoin.cloud
- https://filecoin.services
- modern developer SaaS sites (Vercel, Cloudflare, Stripe)

The site should feel **clean, developer-focused, and minimal**, not overly crypto-marketing.

---

# Visual Style

Clean white background.

Primary color palette:

Primary Blue: #2563EB  
Light Blue: #38BDF8  
Dark Blue: #1E3A8A  
Dark Text: #0F172A  
Secondary Text: #6B7280  

Typography:

Headings: Sora Bold or Inter Bold  
Body: Inter  

Design guidelines:

- lots of whitespace
- soft rounded corners
- minimal shadows
- flat UI components
- subtle gradients only for illustrations
- developer-tool aesthetic
- crisp modern layout

---

# Page Layout

## Hero Section

Show the **FOCify.ME logo** prominently.

Headline:

FOCify.ME

Tagline:

Website → Filecoin in seconds

### Interactive Demo

Include a URL input component directly in the hero.

Example UI:

[ Enter website URL ]

example.com   [ FOCify ]

After clicking the button show a transformation animation:

example.com  
↓  
Pinned on Filecoin  
↓  
https://example.focify.me  

Use smooth animations or a progress indicator.

---

# Section: What FOCify Does

Three-column layout explaining the process.

### Convert

FOCify fetches and converts a website into a static version.

### Store

The content is uploaded to Filecoin using Filecoin Onchain Cloud.

### Serve

The site becomes accessible through a gateway URL.

Use simple icons or diagrams.

---

# Section: Why Use FOC

Card layout with three benefits.

### Low Cost Storage

Store website content cheaply on Filecoin.

### Simple Deployment

No complicated blockchain setup required.

### Gateway Access

Access the site through normal HTTP URLs.

---

# Section: Workflow

Visual pipeline diagram:

Website  
↓  
FOCify  
↓  
Filecoin Storage  
↓  
Gateway URL

Include an optional CLI example:

focify example.com

---

# Footer

Include links:

- GitHub
- Docs
- Filecoin
- FilOz

Footer note:

Built for Filecoin Onchain Cloud
