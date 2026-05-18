#!/usr/bin/env python3
"""
Build a curated markdown library from Open Brain knowledge for Scott Pierce.

Source: thoughts pulled from Open Brain via MCP tools in a Claude session
Filter: aggressive — drops IFTTT/Instapaper auto-imports with no annotation
Format: topic > type, with YAML frontmatter per entry, summary + link only
Target: /Users/scottpierce/Projects/OB1/byoc-exports/open-brain-library/
"""

from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime
import textwrap

ROOT = Path("/sessions/serene-adoring-meitner/mnt/byoc-exports/open-brain-library")

# ---------------------------------------------------------------------------
# Entry model
# ---------------------------------------------------------------------------

@dataclass
class Entry:
    title: str
    url: str
    topic: str       # folder name
    type: str        # links | ideas | summaries
    captured: str    # YYYY-MM-DD
    summary: str
    tags: list = field(default_factory=list)
    source: str = ""   # short source label (e.g. "UX Collective")
    annotated: bool = False  # whether this has Scott's commentary


# ---------------------------------------------------------------------------
# Curated entries (deduplicated by URL, aggressive quality filter applied)
# ---------------------------------------------------------------------------

ENTRIES = [
    # ============== CONTENT DESIGN (discipline) ==============
    Entry("Why Chatbots Are Not the Answer",
          "https://wattenberger.com/thoughts/boo-chatbots",
          "content-design", "links", "2026-03-08",
          "Wattenberger's well-known essay arguing chatbots are a UX failure mode, not a feature. "
          "The blank input box puts the cognitive burden entirely on the user. "
          "Relevant to content design decisions around conversational UI and the limits of chat as a default interaction pattern.",
          tags=["ai", "ux", "chatbots", "content design"], source="wattenberger.com", annotated=True),

    Entry("Content design isn't about words, and never was",
          "https://uxcontent.com/content-design-isnt-about-words-and-never-was/",
          "content-design", "summaries", "2026-04-10",
          "Twenty years of content designers arguing for visibility, met mostly with polite nodding and being looped in after the brief was already written. "
          "AI changed that, but not the way people think.",
          tags=["Artificial Intelligence", "content design", "User Experience"],
          source="UX Content Collective"),

    Entry("Content Design: What It Is and Why You Need It",
          "https://youtube.com/watch?v=zII_CyBhq5c",
          "content-design", "links", "2026-03-21",
          "2015 Code for America Summit breakout — making web content clearer, more understandable, and easier to navigate.",
          tags=["content design"], source="Code for America Summit 2015"),

    Entry("Content designer — gov.uk role definition",
          "https://www.gov.uk/guidance/content-designer",
          "content-design", "links", "2026-03-21",
          "UK government's canonical role definition: what a content designer does and the skills needed.",
          tags=["job description", "roles", "content design"], source="gov.uk"),

    Entry("Content design at Figma (Config 2023)",
          "https://youtube.com/watch?v=Bir6IayQ-Bw",
          "content-design", "links", "2026-03-21",
          "Ryan Reid & Andrew Schmidt — \"Content designers: It's time to design.\" Reframing UX writers as content designers.",
          tags=["content design"], source="Figma Config 2023"),

    Entry("Information Patterns and Narrative Structures in Content",
          "https://lapope.com/2024/11/16/information-patterns-and-narrative-structures-in-content/",
          "content-design", "links", "2026-03-08",
          "Lauren Pope — 10 patterns for structuring content for understanding, engagement, and effectiveness, plus a selection matrix. "
          "Bridges content strategy and information architecture at the practitioner level. Useful as both reference and teaching tool.",
          tags=["content design", "content strategy", "narrative structure", "information design", "ia"],
          source="lapope.com", annotated=True),

    Entry("Content Engineering Lessons We're Taking Into 2026",
          "https://medium.com/thumbtack-design/content-engineering-lessons-were-taking-into-2026-72f07d94d2b3",
          "content-design", "links", "2026-03-08",
          "Thumbtack's content design team on building a content engineering practice — integrating structured content, "
          "systematic decision-making, and scalable operations into content design heading into 2026.",
          tags=["content engineering", "content design", "operations"],
          source="Thumbtack Design / Medium", annotated=True),

    Entry("Algorithm-Driven Design: How AI Is Changing Design",
          "https://www.smashingmagazine.com/2017/01/algorithm-driven-design-how-artificial-intelligence-changing-design",
          "content-design", "links", "2026-03-08",
          "Yury Vetrov — early and still-relevant piece on how algorithmic systems force designers to think in systems rather than artifacts. "
          "Foundational framing for content design as infrastructure rather than creative output.",
          tags=["content design", "algorithm", "systems-thinking"],
          source="Smashing Magazine", annotated=True),

    Entry("How to Build an AI-First Content Design System",
          "https://medium.com/@alemiau/how-to-build-an-ai-first-content-design-system-6891d986c85f",
          "content-design", "links", "2026-03-08",
          "Framework for treating AI as infrastructure, not a replacement threat. Designs content systems that work with AI at the structural level — "
          "AI as a layer the content system is built around, not bolted on after.",
          tags=["content design", "ai infrastructure"],
          source="Medium / @alemiau", annotated=True),

    Entry("Inside the AI Factory",
          "https://nymag.com/intelligencer/article/ai-artificial-intelligence-humans-technology-business-factory.html",
          "content-design", "summaries", "2026-03-08",
          "Investigative piece on the human rater underclass powering AI training pipelines. "
          "Note: relevant to content design's role in shaping AI behavior upstream, not just downstream.",
          tags=["content design", "ai labor", "training data"],
          source="NY Magazine / Intelligencer", annotated=True),

    Entry("Say Anything? Behind the Scenes of Suggested Responses",
          "https://design.facebook.com/stories/say-anything-behind-the-scenes-of-suggested-responses/",
          "content-design", "links", "2026-03-08",
          "How Facebook designs ready-made AI conversation replies using content design principles. "
          "Content decisions behind ML-generated response suggestions — natural, appropriate, on-brand. "
          "Tactical guidance for content design influencing the content principles behind AI/ML products.",
          tags=["content design", "ai product", "suggested responses"],
          source="Facebook Design", annotated=True),

    Entry("Priority Guides: A Content-First Alternative to Wireframes",
          "https://alistapart.com/article/priority-guides-a-content-first-alternative-to-wireframes/",
          "content-design", "links", "2026-03-08",
          "Wireframes front-load visual decisions before content decisions, undermining user-centricity. Priority guides are a content-first alternative: "
          "structure content by hierarchy and user need before any visual thinking. Useful for making the case that content should precede layout.",
          tags=["content", "content design", "content strategy", "ux", "content-first"],
          source="A List Apart", annotated=True),

    Entry("Why We're Moving From Content Strategy to Content Design",
          "https://medium.com/facebook-design/why-were-moving-from-content-strategy-to-content-design-e288a70169b8",
          "content-design", "links", "2026-03-21",
          "Elisabeth Carey (Facebook Product Content Strategy) on the rename and what it represented: "
          "a shift from content as planning artifact to content as scaffolding for product experience.",
          tags=["content strategy", "content design"], source="Facebook Design / Medium"),

    Entry("Content design for coding agent skills",
          "https://medium.com/@ayelet.kessel/content-design-for-coding-agent-skills-c3d15d235b93",
          "content-design", "summaries", "2026-03-30",
          "Ayelet Kessel on building skills for coding agents — content design treated as the spec layer that shapes how agents behave. "
          "Strategic planning at the AI agent / content boundary.",
          tags=["ai", "content design", "agentic", "AI innovation"],
          source="Medium / Ayelet Kessel"),

    Entry("Guide to Agentic Content Design",
          "https://www.linkedin.com/pulse/guide-agentic-content-design-yuval-keshtcher--v6nnf",
          "content-design", "links", "2026-03-24",
          "Yuval Keshtcher — for content designers feeling anxious about the AI landscape, a guide to leaning into language, structure, and intent "
          "as the things AI most needs from us.",
          tags=["content design", "agentic", "Artificial Intelligence", "strategy"],
          source="LinkedIn Pulse"),

    Entry("How to Build a Content Design Agent",
          "https://www.intercom.com/blog/how-to-build-a-content-design-agent/",
          "content-design", "links", "2026-03-08",
          "Intercom argues you need a recipe for great content design before you can automate it. "
          "The agent is only as good as the principles it's given — codified, repeatable standards an agent can actually follow.",
          tags=["content design", "content strategy", "generative ai", "automation"],
          source="Intercom Blog", annotated=True),

    Entry("Reflections from Button 2025: Content design in a government context",
          "https://foleymo.medium.com/reflections-from-button-2025-content-design-in-a-government-context-7452ff213946",
          "content-design", "summaries", "2026-03-21",
          "Government context notes from Button 2025, summarized via Microsoft Copilot.",
          tags=["content design", "government", "conference"], source="Medium / foleymo"),

    Entry("AI is only as clear as we are — why we need a content design mindset",
          "https://tash-willcocks.medium.com/ai-is-only-as-clear-as-we-are-why-we-need-a-content-design-mindset-fab04d31b83d",
          "content-design", "summaries", "2026-03-21",
          "Tash Willcocks — love letter to content designers and how generative AI benefits from their brains.",
          tags=["AI", "content design", "generative AI"], source="Medium / Tash Willcocks"),

    Entry("AI in content and design — Breakthrough or breakdown?",
          "https://contentmeetsdesign.substack.com/p/ai-in-content-and-design",
          "content-design", "summaries", "2026-03-26",
          "Substack from Content Meets Design on whether AI is a breakthrough or breakdown moment for the discipline.",
          tags=["Artificial Intelligence", "content design"], source="Content Meets Design Substack"),

    Entry("Steal These Prompts to Ship Better Product",
          "https://www.reforge.com/blog/steal-these-prompts",
          "content-design", "ideas", "2026-03-21",
          "Four AI prompts for shipping better product: feature taxonomies, compelling narratives, strategic PRD framing, critical evaluation.",
          tags=["ai", "content design", "content strategy", "taxonomy", "prompts", "storyscaping"],
          source="Reforge"),

    Entry("The Determinism Myth — Interactive Demos",
          "https://goodatbingo.github.io/coherent-demos/",
          "content-design", "links", "2026-04-13",
          "Interactive demos on the myth of determinism in design — illustrating how variability isn't a bug to engineer out.",
          tags=["ai", "Artificial Intelligence", "content design"], source="goodatbingo.github.io"),

    Entry("Taking a content design approach to how AI could help our colleagues",
          "https://digitalblog.coop.co.uk/2024/09/12/taking-a-content-design-approach-to-how-ai-could-help-our-colleagues/",
          "content-design", "ideas", "2026-03-21",
          "Co-op Digital Blog on applying content design thinking to internal AI tooling rollouts.",
          tags=["AI", "content design", "colleagues"], source="Co-op Digital"),

    Entry("Content at Parkinson's UK",
          "https://lapope.com/2024/08/21/content-design-atparkinsons-uk/",
          "content-design", "links", "2026-03-21",
          "Lauren Pope's profile of the Parkinson's UK content team and how they operate.",
          tags=["content design"], source="lapope.com"),

    Entry("Connect Your Content for Better Products and Services",
          "https://uxdesign.cc/connect-your-content-for-better-products-and-services-80f3f0fa56b0",
          "content-design", "links", "2026-03-21",
          "On content connections across products and services — for content strategists, service designers, and CX practitioners.",
          tags=["content design", "service design", "customer experience"], source="UX Collective"),

    Entry("Method Podcast: Roxanne Pinto, Google Flights",
          "https://googledesignmethod.libsyn.com/website/roxanne-pinto-google-flights",
          "content-design", "links", "2026-03-21",
          "UX writing for ML-driven products — unpacking errors, mental models, and user trust.",
          tags=["content", "content design"], source="Method Podcast (Google Design)"),

    Entry("The Past, Present and Future of UX Writing and Content Design",
          "https://medium.com/stringshq/the-past-present-and-future-of-ux-writing-and-content-design-an-interview-with-kristina-167cb7953777",
          "content-design", "summaries", "2026-03-21",
          "Kristina Halvorson interview covering the origins of product content design, current challenges, and the most useful framings ahead.",
          tags=["ux writing", "content design"], source="Strings HQ / Medium"),

    Entry("The Content Design Manifesto",
          "https://medium.com/this-is-content-design/the-content-design-manifesto-is-a-durable-resource-59f3a41b2915",
          "content-design", "links", "2026-03-21",
          "Manifesto as a durable resource for the discipline.",
          tags=["content design"], source="This Is Content Design / Medium"),

    Entry("The future of content design in an AI world",
          "https://uxdesign.cc/the-future-of-content-design-in-an-ai-world-bb58ba26455c",
          "content-design", "summaries", "2026-03-21",
          "Follow-up to an earlier piece — generative AI continues to develop, and the bigger-picture question is what that means for the discipline.",
          tags=["generative ai", "content design"], source="UX Collective"),

    Entry("Shopify Just Killed UX Design",
          "https://www.fastcompany.com/91350746/shopify-just-killed-ux-design",
          "content-design", "links", "2026-03-21",
          "Shopify dropped \"UX\" from design and writing titles. Framed as evolution toward outcome-labeled roles. "
          "Relevant for thinking about how content design roles are named, valued, and positioned.",
          tags=["ux", "design", "content design", "leadership"],
          source="Fast Company", annotated=True),

    # Scott's own thoughts
    Entry("Content design is becoming systemic — and what that costs",
          "",
          "content-design", "ideas", "2026-03-29",
          "Personal note: content design is moving toward systems and coherence, finally letting practitioners lean into structuralist thinking that "
          "LLMs make tractable. The worry: structuralism's assumption that meaning is stabilizable contradicts a post-structuralist view where meaning is "
          "context-dependent. As our systems get better at producing consistent language, they may get worse at ambiguity, nuance, and cultural logics. "
          "Open question: how do we validate what's universal vs. what we're forcing into structure because it scales?",
          tags=["content design", "AI", "language", "systems"], source="Scott Pierce"),

    Entry("My role: maturity models, CMS governance, workflow, automation",
          "",
          "content-design", "ideas", "2026-04-17",
          "Personal note: I work on content design maturity models, CMS governance, workflow design, and automation.",
          tags=["content design", "cms governance", "workflow", "automation", "maturity model"],
          source="Scott Pierce"),

    Entry("Notion-based Content Design Document Hub",
          "",
          "content-design", "ideas", "2026-04-17",
          "Personal note: built a Notion-based Content Design Document Hub.",
          tags=["notion", "content design", "document hub"], source="Scott Pierce"),

    Entry("Content design competency matrix + 15K-word maturity series",
          "",
          "content-design", "ideas", "2026-04-17",
          "Personal note: developed a content design competency matrix and a 15,000-word article series on content design maturity.",
          tags=["content design", "competency matrix", "maturity model", "writing"], source="Scott Pierce"),

    Entry("Good at Bingo — Substack on content design leadership and AI readiness",
          "https://goodatbingo.substack.com/",
          "content-design", "ideas", "2026-04-17",
          "Personal note: Good at Bingo is my Substack newsletter covering content design leadership and AI readiness.",
          tags=["content design", "newsletter", "substack"], source="Scott Pierce"),

    Entry("Practitioner-Theory Gap — cross-cutting theme",
          "",
          "content-design", "ideas", "2026-03-08",
          "Cross-cutting theme from the CEM citation guide: Andrew Webb (2025) documents how content design professionals struggle to articulate "
          "measurable value, often fixating on style guide compliance instead of business goals. A document integrating my Content Principles with "
          "Keith Anderson's CEM could either elevate the profession or become another theoretical framework practitioners cite but don't operationalize.",
          tags=["content design", "CEM citation guide", "practitioner-theory gap"], source="Scott Pierce"),

    # ============== CONTENT STRATEGY & GOVERNANCE ==============
    Entry("My content strategy playbook — deliverables by phase",
          "",
          "content-strategy-governance", "ideas", "2026-03-08",
          "Personal note: critical deliverables by phase. Analysis (content inventory report, audit summary), "
          "Strategy (strategy documentation), Guidelines (editorial standards), Governance (process framework). "
          "Resource checklist for engagements: CMS, analytics access, project management tools, content inventory and audit tools, collaboration software.",
          tags=["content strategy", "phases", "deliverables"], source="Scott Pierce"),

    Entry("Modern Content Strategy: Letting Go of Unified, Leaning into Integrated",
          "https://review.content-science.com/modern-content-strategy-letting-go-of-unified-leaning-into-integrated/",
          "content-strategy-governance", "links", "2026-03-21",
          "Content Science Review on why unified content strategy is yielding to integrated content strategy — and what that means in practice.",
          tags=["ai", "content strategy", "content design"], source="Content Science Review"),

    Entry("Managing Backlogs of Web Content: Where to Start",
          "https://contentdesign.london/blog/managing-backlogs-of-web-content-where-to-start",
          "content-strategy-governance", "links", "2026-03-08",
          "Practical guide to tackling large content backlogs — triage, prioritize, begin making progress on accumulated content debt. "
          "Applicable to clients with years of ungoverned content who don't know where to start.",
          tags=["content", "content strategy", "content governance"],
          source="Content Design London", annotated=True),

    Entry("How to Create a Content Model: A Step-By-Step Guide",
          "https://www.sanity.io/content-modeling/how-to-create-a-content-model",
          "content-strategy-governance", "links", "2026-03-21",
          "Sanity's step-by-step content modeling guide.",
          tags=["content modeling", "content strategy", "content governance"], source="Sanity"),

    Entry("Content Modeling: What It Is and How to Get Started",
          "https://www.sanity.io/content-modeling",
          "content-strategy-governance", "links", "2026-03-21",
          "Sanity's foundational explainer on content modeling.",
          tags=["content modeling", "content strategy"], source="Sanity"),

    Entry("The Foundations of Content Modeling",
          "https://www.sanity.io/content-modeling/content-modeling-foundations",
          "content-strategy-governance", "links", "2026-03-21",
          "Foundational reference on content modeling.",
          tags=["content design", "content modeling"], source="Sanity"),

    Entry("How to Develop a Content Taxonomy",
          "https://review.content-science.com/how-to-develop-a-content-taxonomy/",
          "content-strategy-governance", "links", "2026-03-21",
          "Steps for creating a content taxonomy that organizes content and helps users find it.",
          tags=["content taxonomy", "content organization"], source="Content Science Review"),

    Entry("What Is a Taxonomy for Content?",
          "https://review.content-science.com/what-is-a-taxonomy-for-content/",
          "content-strategy-governance", "links", "2026-03-21",
          "Basics of content taxonomy and the benefits for organizations and users.",
          tags=["taxonomy", "content", "organization"], source="Content Science Review"),

    Entry("Content Personalization Fact Sheet",
          "https://review.content-science.com/content-personalization-fact-sheet/",
          "content-strategy-governance", "links", "2026-03-08",
          "Content Science Review fact sheet on personalization.",
          tags=["content strategy", "personalization"], source="Content Science Review"),

    Entry("Content Strategy Aligns You, Your Audience, and Your Content",
          "http://www.content-ment.com/2017/06/content-strategy-aligns-you-your-audience-and-your-content.html",
          "content-strategy-governance", "links", "2026-03-21",
          "Long-running elevator pitch for content strategy: aligning business goals with user expectations via sustainable online content.",
          tags=["content strategy"], source="content-ment.com"),

    Entry("Getting Started in Content Strategy",
          "https://medium.com/facebook-design/getting-started-in-content-strategy-d7543ed22633",
          "content-strategy-governance", "links", "2026-03-21",
          "Facebook Design's primer on content strategy — what the field covers and where to start.",
          tags=["content strategy", "content design"], source="Facebook Design / Medium"),

    Entry("Practical Content Strategy in Action",
          "http://www.uxbooth.com/articles/practical-content-strategy-in-action",
          "content-strategy-governance", "links", "2026-03-21",
          "Joseph Phillips' methodical process for devising, executing, and measuring content strategy projects.",
          tags=["content strategy"], source="UX Booth"),

    Entry("Complete Beginner's Guide to Content Strategy",
          "http://www.uxbooth.com/articles/complete-beginners-guide-to-content-strategy",
          "content-strategy-governance", "links", "2026-03-21",
          "UX Booth beginner's guide covering strategic thinking, digital publishing, IA, and editorial process.",
          tags=["content strategy"], source="UX Booth"),

    Entry("Aligning Content with Business Goals: A Strategic Approach",
          "https://aicontentfy.com/en/blog/aligning-content-with-business-goals-strategic-approach",
          "content-strategy-governance", "links", "2026-03-21",
          "Strategic approach to aligning content with business goals.",
          tags=["content strategy", "business goals"], source="aicontentfy"),

    Entry("Joe Gollner: Multi-Layered Definition of Content",
          "https://ellessmedia.com/csi/joe-gollner/",
          "content-strategy-governance", "links", "2026-03-08",
          "Foundational theoretical definition of content from Joe Gollner.",
          tags=["content strategy", "theory"], source="Elles Media"),

    Entry("Co-op Experience Library — Content Guidelines",
          "https://www.coop.co.uk/experience-library/content-guidelines/",
          "content-strategy-governance", "links", "2026-03-08",
          "Real-world content design system reference.",
          tags=["content design", "design system", "content guidelines"], source="Co-op Experience Library"),

    Entry("Content Strategy for a 200-Page Personal Website",
          "https://www.linkedin.com/pulse/content-strategy-200-page-personal-website-dan-mall-csese",
          "content-strategy-governance", "links", "2026-03-08",
          "Dan Mall's content strategy process for his own site redesign.",
          tags=["content strategy"], source="Dan Mall / LinkedIn"),

    Entry("Ghosts of Content Strategy: Past, Present, and Future",
          "http://www.slideshare.net/carriehane/ghosts-of-content-strategy-past-present-and-future",
          "content-strategy-governance", "links", "2026-03-21",
          "Carrie Hane on the historical arc of content strategy and where it's going.",
          tags=["content strategy"], source="SlideShare / Carrie Hane"),

    # Content governance specifically
    Entry("What's New in Content Governance in SharePoint, OneDrive, and Teams for AI Era",
          "https://techcommunity.microsoft.com/blog/spblog/what%E2%80%99s-new-in-content-governance-in-sharepoint-onedrive-and-teams-for-ai-era/4411645",
          "content-strategy-governance", "summaries", "2026-03-08",
          "Microsoft 365 content governance innovations for Copilot deployment, across five capability areas: "
          "permission/policy controls (Permission State Report, RCD GA, RAC GA, AI-driven Site Matching), site lifecycle policies (Inactive sites v2, Site Ownership, Attestation, RSC), "
          "agent insights and governance for SharePoint Admins, Copilot for SharePoint Admins GA, and cross-tenant content migration. "
          "**Key insight:** content governance is now a prerequisite for Copilot deployment. Overshared, under-permissioned, or inactive content creates risk and degrades AI output quality.",
          tags=["microsoft", "content governance", "sharepoint", "microsoft 365", "copilot"],
          source="Microsoft Tech Community", annotated=True),

    # ============== AI CONTENT & AGENTS ==============
    Entry("Design Principles for AI",
          "https://medium.com/ui-for-ai/design-principles-for-ai-21b6fac23b04",
          "ai-content-and-agents", "links", "2026-03-08",
          "Design principles developed through AI use case research to guide both AI product design in general and specific AI feature work. "
          "Framing of principles as guides — not rules — is particularly applicable.",
          tags=["AI", "design principles", "content design", "generative ai"],
          source="Medium / UI for AI", annotated=True),

    Entry("The Rise of Generative AI-Driven Design Patterns",
          "https://uxdesign.cc/the-rise-of-generative-ai-driven-design-patterns-177cb1380b23",
          "ai-content-and-agents", "links", "2026-03-08",
          "Generative AI advances are shaping feature design — content interaction, design decisions, emerging patterns. "
          "Useful for understanding what AI-native interaction patterns are becoming standard.",
          tags=["ux-writing", "generative-ai", "design-patterns"],
          source="UX Collective", annotated=True),

    Entry("Prompts should be designed — not engineered",
          "https://uxdesign.cc/prompts-should-be-designed-not-engineered-45838a9c3564",
          "ai-content-and-agents", "summaries", "2026-03-21",
          "Argues prompt construction is a design problem (intent, audience, structure) rather than an engineering optimization.",
          tags=["ai", "conversational-design", "llm", "content design"], source="UX Collective"),

    Entry("Let Us Build a Simple Agent Memory Layer Together",
          "https://medium.com/@adedayoagarau/let-us-build-a-simple-agent-memory-layer-together-3fc8a6a39f3b",
          "ai-content-and-agents", "links", "2026-04-13",
          "A content designer's end-to-end guide to building an agent memory layer.",
          tags=["AI agents", "memory layer", "content design"], source="Medium / Adedayo Agarau"),

    Entry("Why Fine-tuning Generative AI Models on Quality Content Matters",
          "https://www.acrolinx.com/blog/why-fine-tuning-generative-ai-models-on-quality-content-matters/",
          "ai-content-and-agents", "links", "2026-03-21",
          "Acrolinx on why content quality directly determines fine-tuning output quality.",
          tags=["generative ai", "content design", "content quality"], source="Acrolinx"),

    Entry("AI doesn't automatically reduce agency — it depends on how you use it",
          "",
          "ai-content-and-agents", "summaries", "2026-03-27",
          "Research note: deep integration (co-authoring with AI) can strengthen control; passive delegation risks 'drift' and erodes autonomy. "
          "Co-authors who actively guide AI maintain higher agency than outsourcers who delegate without engagement. "
          "Three practices to preserve agency: stay inside the cognitive process, maintain human accountability, recognize warning signs (decision paralysis, skill erosion, emotional dependency).",
          tags=["AI integration", "agency", "cognitive sovereignty"], source="Research synthesis"),

    Entry("Signs of AI overuse: cognitive, emotional, professional",
          "",
          "ai-content-and-agents", "summaries", "2026-03-27",
          "Cognitive: mental fog, skill erosion, decision paralysis. "
          "Emotional: dependency on AI for validation, anxiety when offline, reality blurring. "
          "Professional: impersonal outputs, deskilling, accountability gaps. "
          "Key insight: risk isn't usage volume but whether you're actively engaged. Co-authors maintain control; outsourcers experience the negative effects.",
          tags=["AI overuse", "cognitive signs", "emotional signs"], source="Research synthesis"),

    Entry("How AI affects self-awareness and metacognition",
          "",
          "ai-content-and-agents", "summaries", "2026-03-27",
          "AI as reflective tool: mirrors your thought process when co-authoring, amplifies metacognition, highlights skill gaps. "
          "Risks of passive use: delegation erodes self-awareness, over-reliance on AI validation distorts self-perception, reduced accountability weakens grounding. "
          "Practical tip: use AI as a mirror — ask 'why did I choose this direction?' when refining outputs.",
          tags=["AI", "self-awareness", "metacognition"], source="Research synthesis"),

    Entry("How to Worry Wisely About Artificial Intelligence",
          "https://www.economist.com/leaders/2023/04/20/how-to-worry-wisely-about-artificial-intelligence",
          "ai-content-and-agents", "links", "2026-03-08",
          "Calibrated take on separating legitimate AI concerns from hype-driven fear — proportionate worry framing useful for advising clients "
          "and stakeholders navigating AI adoption.",
          tags=["ai-anxiety", "content-strategy", "policy"],
          source="The Economist", annotated=True),

    Entry("AI Ethics, Policy, and Creator Rights (cluster)",
          "",
          "ai-content-and-agents", "links", "2026-03-08",
          "Curated 6-bookmark cluster: "
          "Data Poisoning (The Conversation — creator resistance to AI training scraping); "
          "OpenAI's Alignment Problem (Platformer — board crisis analysis); "
          "YouTube Creators Must Disclose Gen AI Use (Quartz); "
          "Is Argentina the First AI Election? (NYT); "
          "AI & Its Times (Puck News — NYT lawsuit, media/AI détente); "
          "Biden's AI Executive Order (Economist).",
          tags=["ai", "ethics", "policy", "law"], source="Raindrop cluster", annotated=True),

    # ============== CONVERSATIONAL & AI UX ==============
    Entry("Design for conversational user interface (chatbots, virtual assistants)",
          "https://bootcamp.uxdesign.cc/design-for-conversational-user-interface-chatbot-virtual-assistants-af5e3c4af365",
          "conversational-and-ai-ux", "links", "2026-03-21",
          "Designing chatbot and virtual assistant interactions that feel natural.",
          tags=["conversational-design", "ux strategy"], source="UX Collective Bootcamp"),

    Entry("WillowTree's 7 UX/UI Rules for Designing a Conversational AI Assistant",
          "https://www.willowtreeapps.com/insights/willowtrees-7-ux-ui-rules-for-designing-a-conversational-ai-assistant",
          "conversational-and-ai-ux", "links", "2026-03-21",
          "Conversational AI design UX/UI best practices — beyond legacy chatbots.",
          tags=["conversational-design", "ux strategy"], source="WillowTree"),

    Entry("VOICE OF AI",
          "https://www.voiceofai.io/",
          "conversational-and-ai-ux", "links", "2026-04-01",
          "Conversational design site covering voice and AI interaction.",
          tags=["ai", "conversational-design", "voice", "interaction"], source="voiceofai.io"),

    Entry("Stop Designing Chat-Based AI Tools",
          "https://uxplanet.org/stop-designing-chat-based-ai-tools-f68aba9119b4",
          "conversational-and-ai-ux", "summaries", "2026-03-21",
          "Argues it's time to evolve AI tools beyond prompt-based interfaces and consider new mental models. "
          "Companion read to Wattenberger's chatbot critique.",
          tags=["ai", "conversational design", "ux strategy"], source="UX Planet"),

    Entry("Emerging Interaction Patterns in Generative AI Experiences",
          "https://uxdesign.cc/emerging-interaction-patterns-in-generative-ai-experiences-8c351bb3392a",
          "conversational-and-ai-ux", "links", "2026-03-21",
          "How GUI evolution can tell us what to expect for gen AI interactions and interfaces.",
          tags=["ai", "ux", "generative", "ux strategy"], source="UX Collective"),

    Entry("What AI UX Design Can Learn From IKEA Furniture",
          "https://medium.com/design-bootcamp/what-ai-ux-design-can-learn-from-ikea-furniture-9254820831d1",
          "conversational-and-ai-ux", "summaries", "2026-03-21",
          "Anthropology and design theory frames AI UX: humans are messy. What IKEA furniture teaches us about handling that.",
          tags=["AI UX design", "user experience"], source="Medium / Design Bootcamp"),

    # ============== COPILOT & MICROSOFT ==============
    Entry("Building Autonomous AI Agents: A Deep Dive into Copilot Studio's Full Experience",
          "https://medium.com/codex/building-autonomous-ai-agents-a-deep-dive-into-copilot-studios-full-experience-687b553ea7a8",
          "copilot-microsoft", "links", "2026-03-21",
          "How to build autonomous AI agents with Copilot Studio using MCP servers, multi-agent orchestration, and Computer Use for enterprise automation.",
          tags=["copilot studio", "AI agents", "MCP", "orchestration"], source="Medium / Codex"),

    Entry("Content strategy for Microsoft Power Platform implementations",
          "",
          "copilot-microsoft", "ideas", "2026-03-08",
          "Personal playbook note: Power Apps for personalized low-code content delivery by role; Power Automate for content distribution workflows triggered by user actions; "
          "AI Builder for performance analysis and personalization; Data Connectors for real-time updates; Power BI for content performance dashboards; "
          "Common Data Service (CDS) as centralized content repository for cross-application consistency; agile content creation to leverage rapid deployment.",
          tags=["content strategy", "Microsoft Power Platform", "agile content creation"], source="Scott Pierce"),

    # ============== CAREER & CRAFT ==============
    Entry("Directors and Heads of UX: Do You Need Portfolios to Get Hired?",
          "https://uxdesign.cc/directors-and-heads-of-ux-do-you-need-portfolios-to-get-hired-bafbab2436ff",
          "career-and-craft", "links", "2026-03-08",
          "At senior levels, does a portfolio still matter? What replaces it, what still needs to be shown, how to handle the gap. "
          "Directly relevant to director-level job search strategy.",
          tags=["content design", "career", "portfolio", "leadership"],
          source="UX Collective", annotated=True),

    Entry("Why Content Design Portfolios Fail Interviews",
          "https://www.thecontentdesign.co/blog/why-content-design-portfolios-fail-interviews-and-how-to-make-yours-stand-out",
          "career-and-craft", "links", "2026-03-08",
          "Why portfolios fail at the interview stage and how to make yours stand out. Paired with a Portfolio Checklist PDF "
          "(https://usercontent.flodesk.com/35210cd3-78e7-4355-bc45-5f1f88853c37/upload/lvrvk7geha/Portfolio_Checklist_-_The_Content_Design_Co..pdf).",
          tags=["content design", "career", "portfolio"],
          source="The Content Design Co.", annotated=True),

    Entry("From Layoff to Leadership with Cara Lam",
          "https://www.linkedin.com/pulse/from-layoff-leadership-cara-lam-working-in-content-3sh1e",
          "career-and-craft", "links", "2026-03-21",
          "Cara Lam's journey from a layoff at Instagram (with a 60-day work-visa runway) to rebuilding her career as a content design leader.",
          tags=["content design", "leadership", "career"], source="Working in Content / LinkedIn"),

    Entry("Dorcas Adisa perfectly models how to show your work",
          "https://www.linkedin.com/posts/kristinahalvorson_last-year-i-worked-on-the-most-challenging-activity-7287229443176116224-04WW",
          "career-and-craft", "links", "2026-03-21",
          "Kristina Halvorson highlights Dorcas Adisa's modeling of how to show content design work.",
          tags=["ux", "leadership", "content design"], source="Kristina Halvorson / LinkedIn"),

    Entry("Help your team prove the ROI of content design",
          "https://uxcontent.com/ux-content-team-training-roi-content-design/",
          "career-and-craft", "links", "2026-03-21",
          "UX Content Collective on showing content design value through content and usability testing.",
          tags=["roi", "leadership", "content design"], source="UX Content Collective"),

    Entry("Six workshops for all content designers to try",
          "https://rachel-mcconnell.medium.com/six-workshops-for-all-content-designers-to-try-1875f058b468",
          "career-and-craft", "links", "2026-03-21",
          "Rachel McConnell on workshops to build content thinking on product teams.",
          tags=["content design", "workshops", "collaboration"], source="Medium / Rachel McConnell"),

    Entry("Scrum Guide",
          "https://scrumguides.org/scrum-guide.html",
          "career-and-craft", "links", "2026-03-21",
          "Canonical Scrum Guide.",
          tags=["team", "agile"], source="Scrum Guides"),

    Entry("Speak at Content Folks",
          "https://www.content-folks.com/speak-at-content-folks",
          "career-and-craft", "links", "2026-03-08",
          "Speaking opportunity at Content Folks.",
          tags=["speaking", "content design"], source="Content Folks"),

    # Scott's career notes
    Entry("Button 2026 conference talk proposals + Button 2025 attendance",
          "",
          "career-and-craft", "ideas", "2026-04-17",
          "Personal note: developed Button 2026 conference talk proposals. Attended Button 2025 Oct 22–24.",
          tags=["button conference", "speaking", "content design"], source="Scott Pierce"),
]


# ---------------------------------------------------------------------------
# Topic metadata
# ---------------------------------------------------------------------------

TOPIC_META = {
    "content-design": {
        "title": "Content Design",
        "description": "The discipline as practice and theory — what it is, how it's evolving, and where AI is reshaping it.",
    },
    "content-strategy-governance": {
        "title": "Content Strategy & Governance",
        "description": "Strategy, modeling, taxonomy, governance — the planning and stewardship layer beneath content design.",
    },
    "ai-content-and-agents": {
        "title": "AI, Content & Agents",
        "description": "The intersection of content work and AI systems — agents, prompts, generative patterns, ethics, agency.",
    },
    "conversational-and-ai-ux": {
        "title": "Conversational & AI UX",
        "description": "Chatbots, voice, conversational design, and the UX patterns emerging for generative AI experiences.",
    },
    "copilot-microsoft": {
        "title": "Copilot & Microsoft",
        "description": "Copilot Studio, Microsoft 365, Power Platform — content governance and AI agents inside the MS ecosystem.",
    },
    "career-and-craft": {
        "title": "Career & Craft",
        "description": "Leadership, portfolios, the job market, and how the discipline is named, valued, and positioned.",
    },
}

TYPE_META = {
    "links": {"title": "Links", "subtitle": "External references — articles, talks, guides, resources."},
    "ideas": {"title": "Ideas", "subtitle": "Personal synthesis, hypotheses, and idea-tagged captures."},
    "summaries": {"title": "Summaries & Annotations", "subtitle": "Article reactions with commentary and pulled-out insights."},
}


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

def write_entry(entry: Entry) -> str:
    """Render a single entry as markdown."""
    out = []
    out.append(f"### {entry.title}")
    out.append("")
    meta_parts = []
    if entry.url:
        meta_parts.append(f"**Source:** [{entry.source or entry.url}]({entry.url})")
    elif entry.source:
        meta_parts.append(f"**Source:** {entry.source}")
    meta_parts.append(f"**Captured:** {entry.captured}")
    if entry.annotated:
        meta_parts.append("**Annotated**")
    out.append("  \n".join(meta_parts))
    if entry.tags:
        out.append("")
        out.append(f"*Tags:* {', '.join(entry.tags)}")
    out.append("")
    out.append(entry.summary)
    out.append("")
    out.append("---")
    out.append("")
    return "\n".join(out)


def write_topic_file(topic: str, type_: str, entries: list):
    folder = ROOT / topic
    folder.mkdir(parents=True, exist_ok=True)
    file_path = folder / f"{type_}.md"

    topic_meta = TOPIC_META[topic]
    type_meta = TYPE_META[type_]

    # YAML frontmatter
    fm = [
        "---",
        f"title: \"{topic_meta['title']} — {type_meta['title']}\"",
        f"topic: {topic}",
        f"type: {type_}",
        f"count: {len(entries)}",
        f"generated: {datetime.utcnow().isoformat()}Z",
        f"source: Open Brain (curated, deduplicated, summary+link only)",
        "---",
        "",
        f"# {topic_meta['title']} — {type_meta['title']}",
        "",
        f"_{type_meta['subtitle']}_",
        "",
        f"**Topic scope.** {topic_meta['description']}",
        "",
        f"**Entries:** {len(entries)}",
        "",
        "---",
        "",
    ]

    body = [write_entry(e) for e in entries]
    file_path.write_text("\n".join(fm) + "\n".join(body))
    return file_path


def write_readme():
    """Write the root README index."""
    lines = [
        "---",
        "title: \"Open Brain Knowledge Library\"",
        f"generated: {datetime.utcnow().isoformat()}Z",
        f"source_total: 1553",
        f"curated_total: {len(ENTRIES)}",
        "---",
        "",
        "# Open Brain Knowledge Library",
        "",
        "Curated extract from Scott Pierce's Open Brain corpus — content design, content strategy, ",
        "AI/agent UX, conversational design, Copilot/Microsoft ecosystem, and career craft.",
        "",
        "## What's here",
        "",
        "- **Format:** topic > type (links / ideas / summaries)",
        "- **Filter:** aggressive — annotated reading-list entries and substantive references only. ",
        "  Pure IFTTT/Instapaper auto-imports without commentary were dropped.",
        "- **Content:** title, source link, capture date, tags, and a 1–3 line summary. ",
        "  Long inline article bodies were dropped; the URL is preserved.",
        f"- **Source pool:** 1,553 Open Brain thoughts (3/21/2026 → 5/18/2026). "
        f"This library curates {len(ENTRIES)} of those.",
        "",
        "## Folders",
        "",
    ]

    # Count by topic
    counts = {}
    for e in ENTRIES:
        counts[e.topic] = counts.get(e.topic, 0) + 1

    for topic, meta in TOPIC_META.items():
        c = counts.get(topic, 0)
        lines.append(f"### [{meta['title']}](./{topic}/) ({c} entries)")
        lines.append("")
        lines.append(meta["description"])
        lines.append("")
        # File links
        topic_entries = [e for e in ENTRIES if e.topic == topic]
        for type_ in ("links", "ideas", "summaries"):
            type_count = sum(1 for e in topic_entries if e.type == type_)
            if type_count:
                lines.append(f"- [{TYPE_META[type_]['title']}](./{topic}/{type_}.md) — {type_count} entries")
        lines.append("")

    lines.append("## How this was built")
    lines.append("")
    lines.append("Pulled from Open Brain via MCP `search_thoughts` and `list_thoughts` across these topic seeds: ")
    lines.append("`content design`, `content strategy`, `content governance`, `conversational-design`, ")
    lines.append("`Copilot Studio`, `AI agents`, `prompt engineering`, `Microsoft Power Platform`, `design principles`, ")
    lines.append("`structured content`. Deduplicated by source URL. Items with only auto-import boilerplate ")
    lines.append("(e.g. \"X via Instapaper\") were filtered out unless they were the only source for a URL.")
    lines.append("")
    lines.append("## Re-running or extending")
    lines.append("")
    lines.append("This library is a snapshot. To refresh: re-run the equivalent searches, dedupe by URL, ")
    lines.append("and either replace this folder or merge in new entries. The generation script lives ")
    lines.append("alongside the session that produced it.")
    lines.append("")

    (ROOT / "README.md").write_text("\n".join(lines))


def main():
    ROOT.mkdir(parents=True, exist_ok=True)

    # Group entries by (topic, type)
    grouped = {}
    for e in ENTRIES:
        key = (e.topic, e.type)
        grouped.setdefault(key, []).append(e)

    # Write topic/type files
    written = []
    for (topic, type_), entries in sorted(grouped.items()):
        # Sort entries: annotated first, then by captured date desc
        entries.sort(key=lambda x: (not x.annotated, x.captured), reverse=False)
        path = write_topic_file(topic, type_, entries)
        written.append((path, len(entries)))

    # Write root README
    write_readme()

    print(f"Wrote {len(written)} topic/type files + README:")
    for path, count in written:
        print(f"  {path.relative_to(ROOT)} ({count} entries)")
    print(f"\nTotal curated entries: {len(ENTRIES)}")
    print(f"Library root: {ROOT}")


if __name__ == "__main__":
    main()
