import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const fps = 30;
const introFrames = 240;
const sectionFrames = 570;
const outroFrames = 330;
const sections = [
  {
    slug: "dashboard-overview",
    title: "Dashboard",
    eyebrow: "One operational scan",
    summary: "Status, type mix, top topics, active workflow, and recent continuity in one place.",
  },
  {
    slug: "thoughts-table",
    title: "Thoughts",
    eyebrow: "Canonical memory list",
    summary: "Dense filtering for the raw memory graph: type, source, importance, and detail drill-in.",
  },
  {
    slug: "workflow-board",
    title: "Workflow",
    eyebrow: "Task continuity",
    summary: "Tasks and ideas become durable work state, not buried chat context.",
  },
  {
    slug: "agent-memory-review",
    title: "Agent Memory",
    eyebrow: "Governed write-back",
    summary: "Agent-written memory starts as evidence until humans confirm, restrict, stale, or reject it.",
  },
  {
    slug: "recall-trace",
    title: "Recall Trace",
    eyebrow: "Debug retrieval",
    summary: "See what the agent asked for, what OB1 returned, and which memories shaped the work.",
  },
  {
    slug: "duplicates-review",
    title: "Duplicates",
    eyebrow: "Memory hygiene",
    summary: "Compare similar thoughts side by side before repeated context pollutes the graph.",
  },
  {
    slug: "audit-quality",
    title: "Audit",
    eyebrow: "Safety pass",
    summary: "Low-quality thoughts and bad assumptions are surfaced before they become hidden behavior.",
  },
];

const durationInFrames = introFrames + sections.length * sectionFrames + outroFrames;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="OB1AgentDashboard"
      component={OB1AgentDashboard}
      durationInFrames={durationInFrames}
      fps={fps}
      width={1920}
      height={1080}
    />
    <Composition
      id="OB1AgentMemoryEndcap"
      component={OB1AgentMemoryEndcap}
      durationInFrames={3600}
      fps={fps}
      width={1920}
      height={1080}
    />
    <Composition
      id="OB1AgentMemoryAnnouncement"
      component={OB1AgentMemoryAnnouncement}
      durationInFrames={450}
      fps={fps}
      width={1920}
      height={1080}
    />
  </>
);

export default RemotionRoot;

const OB1AgentDashboard: React.FC = () => {
  return (
    <AbsoluteFill style={styles.base}>
      <Audio src={staticFile("audio/voiceover.mp3")} />
      <Pinstripe />
      <Sequence durationInFrames={introFrames}>
        <Intro />
      </Sequence>
      {sections.map((section, index) => (
        <Sequence
          key={section.slug}
          from={introFrames + index * sectionFrames}
          durationInFrames={sectionFrames}
        >
          <SectionSlide section={section} index={index} />
        </Sequence>
      ))}
      <Sequence from={introFrames + sections.length * sectionFrames} durationInFrames={outroFrames}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};

const endcapScenes = [
  {
    from: 0,
    duration: 300,
    kind: "hero",
    title: "What the OpenBrain recipe does",
    eyebrow: "OPENCLAW AGENT MEMORY",
    summary: "Recall before serious work. Write back after serious work. Label memory so future agents can trust it.",
    visual: "hero",
  },
  {
    from: 300,
    duration: 360,
    kind: "generated",
    title: "Retrieve before the task",
    eyebrow: "BEFORE MEANINGFUL WORK",
    summary: "Project context, people, decisions, prior failures, current tasks, and constraints get recalled for the Claw.",
    visual: "context",
  },
  {
    from: 660,
    duration: 360,
    kind: "generated",
    title: "Write back after work",
    eyebrow: "AFTER SERIOUS WORK",
    summary: "Outputs, lessons, unresolved questions, source channel, model use, task ID, confidence, and confirmation status.",
    visual: "writebackFields",
  },
  {
    from: 1020,
    duration: 360,
    kind: "generated",
    title: "Provenance makes memory useful",
    eyebrow: "HOW DID WE GET IT?",
    summary: "Observed from a source, inferred by a model, confirmed by a user, or imported from a transcript.",
    visual: "provenanceMatrix",
  },
  {
    from: 1380,
    duration: 360,
    kind: "screenshot",
    title: "Can it become instruction?",
    eyebrow: "USER CONFIRMATION STATUS",
    summary: "The dashboard keeps agent-written memory reviewable before it guides future work.",
    asset: "screenshots/agent-memory-review.png",
  },
  {
    from: 1740,
    duration: 360,
    kind: "generated",
    title: "Clear labels prevent bad memory",
    eyebrow: "DANGEROUS WITHOUT LABELS",
    summary: "Bad memory makes agents confidently wrong. Good labels make memory operational.",
    visual: "badGood",
  },
  {
    from: 2100,
    duration: 420,
    kind: "workflow",
    title: "Three recipes ship together",
    eyebrow: "CODE REVIEW + TASKFLOW + PROVENANCE",
    summary: "PR lessons, long-running work logs, and source labels give future agents reusable context.",
    visual: "recipeSet",
  },
  {
    from: 2520,
    duration: 420,
    kind: "generated",
    title: "One loop, swappable brains",
    eyebrow: "SERIOUS OPENCLAW WORK",
    summary: "Build one agentic pipeline, swap models inside it, and keep memory independent of the brain.",
    visual: "brainSwap",
  },
  {
    from: 2940,
    duration: 660,
    kind: "cta",
    title: "Get the full recipe from Nate",
    eyebrow: "DETAILS ON SUBSTACK",
    summary: "Guide on Nate's Substack. Code in the open source OpenBrain repo.",
    asset: "brand/ob1-beanie-mark-green.png",
  },
];

const OB1AgentMemoryEndcap: React.FC = () => {
  return (
    <AbsoluteFill style={styles.base}>
      <Pinstripe />
      {endcapScenes.map((scene) => (
        <Sequence key={`${scene.from}-${scene.title}`} from={scene.from} durationInFrames={scene.duration}>
          <EndcapScene scene={scene} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const OB1AgentMemoryAnnouncement: React.FC = () => {
  const frame = useCurrentFrame();
  const titleOpacity = interpolate(frame, [0, 32], [0, 1], { extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 45], [28, 0], { extrapolateRight: "clamp" });
  const cardsOpacity = interpolate(frame, [78, 130], [0, 1], { extrapolateRight: "clamp" });
  const cardsY = interpolate(frame, [78, 140], [26, 0], { extrapolateRight: "clamp" });
  const markScale = interpolate(frame, [0, 450], [1, 1.055]);

  return (
    <AbsoluteFill style={styles.base}>
      <Pinstripe />
      <div style={styles.announcementMarkWrap}>
        <Img
          src={staticFile("brand/ob1-beanie-mark-green.png")}
          style={{ ...styles.announcementMark, transform: `scale(${markScale})` }}
        />
      </div>
      <div style={styles.announcementPage}>
        <div style={styles.endcapBrandRow}>
          <Img src={staticFile("brand/ob1-logo.png")} style={styles.endcapLogo} />
          <span>NATE B. JONES / OPENBRAIN</span>
        </div>
        <div style={{ ...styles.announcementHero, opacity: titleOpacity, transform: `translateY(${titleY}px)` }}>
          <div style={styles.eyebrow}>LIVE NOW</div>
          <h1 style={styles.announcementTitle}>OpenClaw Agent Memory for OpenBrain</h1>
          <p style={styles.announcementSubhead}>A governed memory recipe for durable, brain-swappable agent work.</p>
        </div>
        <div style={{ ...styles.announcementCards, opacity: cardsOpacity, transform: `translateY(${cardsY}px)` }}>
          <AnnouncementCard label="Guide available through" value="Nate's Substack" />
          <AnnouncementCard label="Official plugin on" value="ClawHub" />
          <AnnouncementCard label="Source + recipes in" value="The OB1 repo" />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const AnnouncementCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={styles.announcementCard}>
    <div style={styles.announcementCardLabel}>{label}</div>
    <div style={styles.announcementCardValue}>{value}</div>
  </div>
);

const EndcapScene: React.FC<{ scene: (typeof endcapScenes)[number] }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 36], [0, 1], { extrapolateRight: "clamp" });
  const exit = interpolate(frame, [scene.duration - 30, scene.duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = enter * exit;
  const y = interpolate(frame, [0, 46], [26, 0], { extrapolateRight: "clamp" });
  const imageScale = interpolate(frame, [0, scene.duration], [1.01, 1.045]);

  if (scene.kind === "cta") {
    return (
      <AbsoluteFill style={{ ...styles.endcapPage, opacity }}>
        <div style={styles.endcapBrandRow}>
          <Img src={staticFile("brand/ob1-logo.png")} style={styles.endcapLogo} />
          <span>NATE B. JONES / OB1</span>
        </div>
        <div style={{ ...styles.ctaGrid, transform: `translateY(${y}px)` }}>
          <div>
            <div style={styles.eyebrow}>{scene.eyebrow}</div>
            <h1 style={styles.endcapHeroTitle}>{scene.title}</h1>
            <p style={styles.ctaLead}>{scene.summary}</p>
            <div style={styles.commandBox}>NATE'S SUBSTACK</div>
            <div style={styles.ctaLinks}>
              <span>Open source OpenBrain repo</span>
              <span>NATE B. JONES / OB1</span>
            </div>
          </div>
          <div style={styles.ctaMarkWrap}>
            <Img src={staticFile(scene.asset)} style={styles.ctaMark} />
          </div>
        </div>
        <div style={styles.cornerMark}>OPENCLAW AGENT MEMORY FOR OPENBRAIN</div>
      </AbsoluteFill>
    );
  }

  if (scene.kind === "workflow") {
    return (
      <AbsoluteFill style={{ ...styles.endcapPage, opacity }}>
        <EndcapHeader />
        <div style={styles.assetGrid}>
          <GeneratedVisual type={scene.visual ?? "recipes"} scale={imageScale} />
          <EndcapText scene={scene} y={y} />
        </div>
      </AbsoluteFill>
    );
  }

  if (scene.kind === "hero") {
    return (
      <AbsoluteFill style={{ ...styles.endcapPage, opacity }}>
        <div style={styles.heroGridBackground}>
          <GeneratedVisual type="heroNetwork" scale={imageScale} />
        </div>
        <div style={{ ...styles.heroOverlayClean, transform: `translateY(${y}px)` }}>
          <div style={styles.endcapBrandRow}>
            <Img src={staticFile("brand/ob1-logo.png")} style={styles.endcapLogo} />
            <span>{scene.eyebrow}</span>
          </div>
          <h1 style={styles.endcapHeroTitle}>{scene.title}</h1>
          <p style={styles.endcapHeroText}>{scene.summary}</p>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ ...styles.endcapPage, opacity }}>
      <EndcapHeader />
      <div style={styles.assetGrid}>
        {scene.kind === "generated" ? (
          <GeneratedVisual type={scene.visual ?? "stack"} scale={imageScale} />
        ) : (
          <EndcapImage src={scene.asset} scale={imageScale} />
        )}
        <EndcapText scene={scene} y={y} />
      </div>
    </AbsoluteFill>
  );
};

const EndcapHeader: React.FC = () => (
  <div style={styles.endcapBrandRow}>
    <Img src={staticFile("brand/ob1-logo.png")} style={styles.endcapLogo} />
    <span>NATE B. JONES / OB1 AGENT MEMORY</span>
  </div>
);

const EndcapImage: React.FC<{ src: string; scale: number }> = ({ src, scale }) => (
  <div style={styles.endcapImageFrame}>
    <Img src={staticFile(src)} style={{ ...styles.endcapImage, transform: `scale(${scale})` }} />
  </div>
);

const GeneratedVisual: React.FC<{ type: string; scale: number }> = ({ type, scale }) => {
  if (type === "heroNetwork") {
    return (
      <div style={{ ...styles.generatedFrame, transform: `scale(${scale})` }}>
        <div style={styles.signalGrid}>
          {["OpenClaw runtime", "GPT-5.5", "local models", "TaskFlow", "Slack", "GitHub", "OB1 memory"].map(
            (label, index) => (
              <div key={label} style={{ ...styles.signalNode, left: `${12 + (index % 4) * 22}%`, top: `${18 + Math.floor(index / 4) * 32}%` }}>
                {label}
              </div>
            )
          )}
        </div>
        <div style={styles.heroMemoryCore}>
          <Img src={staticFile("brand/ob1-beanie-mark-green.png")} style={styles.heroMemoryMark} />
          <div>
            <div style={styles.generatedEyebrow}>USER-OWNED MEMORY</div>
            <div style={styles.generatedCoreTitle}>OB1</div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "stack") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.stackColumns}>
          <VisualColumn title="Channels" items={["Slack", "Telegram", "GitHub", "Browser"]} />
          <VisualColumn title="Runtime" items={["OpenClaw", "TaskFlow", "Tools", "Permissions"]} featured />
          <VisualColumn title="Brains" items={["GPT-5.5", "Claude", "Gemini", "Local"]} />
          <VisualColumn title="Memory" items={["Recall", "Write-back", "Review", "Trace"]} featured />
        </div>
        <ConnectorLine left="24%" top="49%" width="52%" />
      </GeneratedFrame>
    );
  }

  if (type === "recall") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.loopLayout}>
          {["Task starts", "Recall scoped context", "Agent works", "Report usage"].map((label, index) => (
            <LoopNode key={label} label={label} index={index} />
          ))}
          <div style={styles.loopCenter}>OB1<br />RECALL</div>
        </div>
      </GeneratedFrame>
    );
  }

  if (type === "writeback") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.pipeline}>
          {[
            ["Finish", "Task output"],
            ["Filter", "Secrets + raw dumps"],
            ["Compact", "Decision / lesson / failure"],
            ["Review", "Evidence before instruction"],
            ["Reuse", "Future task context"],
          ].map(([title, body]) => (
            <PipelineCard key={title} title={title} body={body} />
          ))}
        </div>
      </GeneratedFrame>
    );
  }

  if (type === "context") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.contextGrid}>
          {["project context", "people", "decisions", "prior failures", "current tasks", "constraints"].map(
            (item, index) => (
              <div key={item} style={{ ...styles.contextTile, ...(index === 2 || index === 3 ? styles.contextTileFeatured : {}) }}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item}</strong>
              </div>
            )
          )}
        </div>
        <div style={styles.contextCore}>RECALL</div>
      </GeneratedFrame>
    );
  }

  if (type === "writebackFields") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.fieldGrid}>
          {["outputs", "lessons", "unresolved questions", "source channel", "model use", "task ID", "confidence", "confirmation status"].map(
            (item) => (
              <div key={item} style={styles.fieldPill}>{item}</div>
            )
          )}
        </div>
        <div style={styles.fieldFooter}>WRITE-BACK CONTRACT</div>
      </GeneratedFrame>
    );
  }

  if (type === "provenanceMatrix") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.provenanceGrid}>
          <ProvenanceCard title="Observed" body="from source" />
          <ProvenanceCard title="Inferred" body="by model" />
          <ProvenanceCard title="Confirmed" body="by user" />
          <ProvenanceCard title="Imported" body="from transcript" />
        </div>
        <div style={styles.validityStrip}>Is it valid? Can it instruct later?</div>
      </GeneratedFrame>
    );
  }

  if (type === "badGood") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.badGoodGrid}>
          <div style={styles.badPanel}>
            <div style={styles.badGoodKicker}>BAD MEMORY</div>
            <div style={styles.badGoodTitle}>confidently wrong</div>
            <div style={styles.badGoodBody}>unlabeled inference becomes hidden instruction</div>
          </div>
          <div style={styles.goodPanel}>
            <div style={styles.badGoodKicker}>GOOD ARCHITECTURE</div>
            <div style={styles.badGoodTitle}>continuous, accountable</div>
            <div style={styles.badGoodBody}>source, confidence, scope, and confirmation travel with the memory</div>
          </div>
        </div>
      </GeneratedFrame>
    );
  }

  if (type === "brainSwap") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.brainSwapGrid}>
          <VisualColumn title="One Loop" items={["recall", "work", "write-back", "review"]} featured />
          <VisualColumn title="Swap Brains" items={["GPT-5.5", "Claude", "Gemini", "local"]} />
          <VisualColumn title="Same Memory" items={["scope", "source", "confidence", "policy"]} featured />
        </div>
        <ConnectorLine left="21%" top="50%" width="58%" />
      </GeneratedFrame>
    );
  }

  if (type === "recipeSet") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.recipeSetGrid}>
          <RecipeCard title="Code Review Memory" items={["PR lessons", "repo conventions", "bugs to catch"]} />
          <RecipeCard title="TaskFlow Work Log" items={["attempted", "changed", "blocked"]} />
          <RecipeCard title="Memory + Provenance" items={["observed", "confirmed", "imported"]} />
        </div>
      </GeneratedFrame>
    );
  }

  if (type === "trust") {
    return (
      <GeneratedFrame scale={scale}>
        <div style={styles.trustLadder}>
          {["Generated", "Inferred", "Observed", "Imported", "User-confirmed", "Instruction-grade"].map(
            (label, index) => (
              <div key={label} style={{ ...styles.trustStep, width: `${44 + index * 8}%` }}>
                <span>{label}</span>
                <small>{index < 2 ? "evidence" : index < 4 ? "source-backed" : "can guide agents"}</small>
              </div>
            )
          )}
        </div>
      </GeneratedFrame>
    );
  }

  return (
    <GeneratedFrame scale={scale}>
      <div style={styles.recipeGrid}>
        <RecipeCard title="Code Review Memory" items={["repo conventions", "prior bugs", "review lessons", "tests + false positives"]} />
        <RecipeCard title="TaskFlow Work Log" items={["attempted work", "what changed", "blockers", "next agent context"]} />
      </div>
    </GeneratedFrame>
  );
};

const ProvenanceCard: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div style={styles.provenanceCard}>
    <div style={styles.provenanceTitle}>{title}</div>
    <div style={styles.provenanceBody}>{body}</div>
  </div>
);

const GeneratedFrame: React.FC<React.PropsWithChildren<{ scale: number }>> = ({ scale, children }) => (
  <div style={styles.generatedFrameOuter}>
    <div style={{ ...styles.generatedFrame, transform: `scale(${scale})` }}>{children}</div>
  </div>
);

const VisualColumn: React.FC<{ title: string; items: string[]; featured?: boolean }> = ({ title, items, featured }) => (
  <div style={{ ...styles.visualColumn, ...(featured ? styles.visualColumnFeatured : {}) }}>
    <div style={styles.visualColumnTitle}>{title}</div>
    {items.map((item) => (
      <div key={item} style={styles.visualPill}>{item}</div>
    ))}
  </div>
);

const ConnectorLine: React.FC<{ left: string; top: string; width: string }> = ({ left, top, width }) => (
  <div style={{ ...styles.connectorLine, left, top, width }} />
);

const LoopNode: React.FC<{ label: string; index: number }> = ({ label, index }) => {
  const positions = [
    { left: "39%", top: "9%" },
    { left: "68%", top: "39%" },
    { left: "39%", top: "68%" },
    { left: "10%", top: "39%" },
  ];
  return <div style={{ ...styles.loopNode, ...positions[index] }}>{label}</div>;
};

const PipelineCard: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div style={styles.pipelineCard}>
    <div style={styles.pipelineTitle}>{title}</div>
    <div style={styles.pipelineBody}>{body}</div>
  </div>
);

const RecipeCard: React.FC<{ title: string; items: string[] }> = ({ title, items }) => (
  <div style={styles.recipeCard}>
    <div style={styles.recipeTitle}>{title}</div>
    {items.map((item) => (
      <div key={item} style={styles.recipeItem}>{item}</div>
    ))}
  </div>
);

const EndcapText: React.FC<{ scene: (typeof endcapScenes)[number]; y: number }> = ({ scene, y }) => (
  <div style={{ ...styles.endcapTextPanel, transform: `translateY(${y}px)` }}>
    <div style={styles.eyebrow}>{scene.eyebrow}</div>
    <h2 style={styles.endcapTitle}>{scene.title}</h2>
    <p style={styles.endcapSummary}>{scene.summary}</p>
  </div>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 45], [0, 1], { extrapolateRight: "clamp" });
  const y = interpolate(frame, [0, 70], [30, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={styles.page}>
      <div style={styles.brandRow}>
        <Img src={staticFile("brand/ob1-logo.png")} style={styles.logo} />
        <span>NATE B. JONES / OB1</span>
      </div>
      <div style={{ ...styles.hero, opacity, transform: `translateY(${y}px)` }}>
        <h1 style={styles.heroTitle}>OB1 Agent Dashboard Walkthrough</h1>
        <p style={styles.heroText}>
          A visual guide to the surfaces that make agent memory visible, reviewable, and useful.
        </p>
      </div>
      <div style={styles.cornerMark}>PERSONAL CONTINUITY LAYER / OPENCLAW LAUNCH DEMO</div>
    </AbsoluteFill>
  );
};

const SectionSlide: React.FC<{
  section: (typeof sections)[number];
  index: number;
}> = ({ section, index }) => {
  const frame = useCurrentFrame();
  const progress = frame / sectionFrames;
  const imageScale = interpolate(progress, [0, 1], [1.01, 1.055]);
  const imageX = interpolate(progress, [0, 1], [0, -18]);
  const panelOpacity = interpolate(frame, [20, 70, sectionFrames - 45, sectionFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const panelY = interpolate(frame, [20, 80], [22, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={styles.sectionPage}>
      <div style={styles.screenshotFrame}>
        <Img
          src={staticFile(`screenshots/${section.slug}.png`)}
          style={{
            ...styles.screenshot,
            transform: `translateX(${imageX}px) scale(${imageScale})`,
          }}
        />
      </div>
      <div
        style={{
          ...styles.infoPanel,
          opacity: panelOpacity,
          transform: `translateY(${panelY}px)`,
        }}
      >
        <div style={styles.eyebrow}>{section.eyebrow}</div>
        <h2 style={styles.sectionTitle}>{section.title}</h2>
        <p style={styles.sectionSummary}>{section.summary}</p>
        <div style={styles.divider} />
        <div style={styles.number}>{String(index + 1).padStart(2, "0")} / 07</div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 45], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={styles.page}>
      <div style={{ ...styles.outroPanel, opacity }}>
        <div style={styles.eyebrow}>The Launch Story</div>
        <h2 style={styles.outroTitle}>OpenClaw is the runtime. OB1 is the continuity layer.</h2>
        <p style={styles.outroText}>
          The dashboard makes memory visible, editable, and trustworthy enough for durable agent work.
        </p>
      </div>
      <div style={styles.footerBrand}>NBJ / OB1</div>
    </AbsoluteFill>
  );
};

const Pinstripe: React.FC = () => {
  const { width, height } = useVideoConfig();
  const rows = Math.ceil(height / 24);
  const cols = Math.ceil(width / 132);
  const items = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      items.push(
        <span
          key={`${x}-${y}`}
          style={{
            position: "absolute",
            left: x * 132 + (y % 2 ? 66 : 0),
            top: y * 24,
            color: "rgba(236,229,209,0.055)",
            fontFamily: "Menlo, monospace",
            fontSize: 7,
            letterSpacing: 2.2,
          }}
        >
          NBJ OB1
        </span>
      );
    }
  }
  return <AbsoluteFill>{items}</AbsoluteFill>;
};

const styles: Record<string, React.CSSProperties> = {
  base: {
    background: "linear-gradient(125deg, #151a16, #0f120f 68%)",
    color: "#ece5d1",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  page: {
    padding: 96,
  },
  sectionPage: {
    padding: 74,
    display: "grid",
    gridTemplateColumns: "1180px 1fr",
    gap: 58,
    alignItems: "center",
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: 18,
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 3,
  },
  logo: {
    width: 54,
    height: 54,
    objectFit: "contain",
    border: "1px solid rgba(166,198,117,.45)",
    padding: 10,
  },
  hero: {
    marginTop: 170,
    maxWidth: 1120,
  },
  heroTitle: {
    margin: 0,
    fontSize: 104,
    lineHeight: 0.94,
    letterSpacing: 0,
    fontWeight: 560,
  },
  heroText: {
    marginTop: 34,
    maxWidth: 880,
    color: "rgba(236,229,209,.72)",
    fontSize: 33,
    lineHeight: 1.32,
  },
  cornerMark: {
    position: "absolute",
    right: 96,
    bottom: 76,
    color: "rgba(236,229,209,.52)",
    fontFamily: "Menlo, monospace",
    fontSize: 14,
    letterSpacing: 2.2,
  },
  screenshotFrame: {
    width: 1180,
    height: 664,
    overflow: "hidden",
    border: "1px solid rgba(236,229,209,.2)",
    boxShadow: "0 28px 90px rgba(0,0,0,.42)",
  },
  screenshot: {
    width: 1180,
    height: 664,
    objectFit: "cover",
    transformOrigin: "center",
  },
  infoPanel: {
    border: "1px solid rgba(236,229,209,.16)",
    background: "rgba(16,19,16,.72)",
    padding: 42,
  },
  eyebrow: {
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 4,
    textTransform: "uppercase",
  },
  sectionTitle: {
    margin: "20px 0 18px",
    fontSize: 70,
    lineHeight: 0.98,
    letterSpacing: 0,
  },
  sectionSummary: {
    color: "rgba(236,229,209,.74)",
    fontSize: 28,
    lineHeight: 1.32,
  },
  divider: {
    height: 1,
    margin: "42px 0 20px",
    background: "rgba(236,229,209,.18)",
  },
  number: {
    color: "rgba(236,229,209,.5)",
    fontFamily: "Menlo, monospace",
    fontSize: 16,
    letterSpacing: 2,
  },
  outroPanel: {
    maxWidth: 1220,
    marginTop: 170,
  },
  outroTitle: {
    margin: "20px 0 24px",
    fontSize: 88,
    lineHeight: 0.98,
    letterSpacing: 0,
  },
  outroText: {
    maxWidth: 960,
    color: "rgba(236,229,209,.72)",
    fontSize: 34,
    lineHeight: 1.32,
  },
  footerBrand: {
    position: "absolute",
    left: 96,
    bottom: 76,
    color: "rgba(236,229,209,.52)",
    fontFamily: "Menlo, monospace",
    fontSize: 18,
    letterSpacing: 3,
  },
  endcapPage: {
    padding: 72,
  },
  endcapBrandRow: {
    display: "flex",
    alignItems: "center",
    gap: 18,
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  endcapLogo: {
    width: 50,
    height: 50,
    objectFit: "contain",
    border: "1px solid rgba(166,198,117,.45)",
    padding: 9,
    background: "rgba(12,14,12,.58)",
  },
  assetGrid: {
    height: 860,
    display: "grid",
    gridTemplateColumns: "1160px 1fr",
    gap: 54,
    alignItems: "center",
  },
  workflowGrid: {
    height: 610,
    marginTop: 56,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 32,
    alignItems: "center",
  },
  endcapImageFrame: {
    width: "100%",
    aspectRatio: "16 / 9",
    overflow: "hidden",
    border: "1px solid rgba(236,229,209,.2)",
    background: "rgba(12,14,12,.72)",
    boxShadow: "0 28px 90px rgba(0,0,0,.46)",
  },
  endcapImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transformOrigin: "center",
  },
  endcapTextPanel: {
    borderLeft: "1px solid rgba(166,198,117,.52)",
    paddingLeft: 34,
  },
  endcapTitle: {
    margin: "20px 0 20px",
    fontSize: 68,
    lineHeight: 0.98,
    letterSpacing: 0,
    fontWeight: 620,
  },
  endcapSummary: {
    margin: 0,
    color: "rgba(236,229,209,.74)",
    fontSize: 29,
    lineHeight: 1.32,
  },
  heroMedia: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    opacity: 0.72,
  },
  heroMediaImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transformOrigin: "center",
  },
  heroOverlay: {
    position: "absolute",
    left: 96,
    bottom: 112,
    maxWidth: 1140,
  },
  endcapHeroTitle: {
    margin: "38px 0 24px",
    fontSize: 104,
    lineHeight: 0.92,
    letterSpacing: 0,
    fontWeight: 650,
  },
  endcapHeroText: {
    margin: 0,
    maxWidth: 910,
    color: "rgba(236,229,209,.78)",
    fontSize: 34,
    lineHeight: 1.28,
  },
  ctaGrid: {
    height: 850,
    display: "grid",
    gridTemplateColumns: "1fr 460px",
    gap: 74,
    alignItems: "center",
  },
  ctaLead: {
    margin: "0 0 22px",
    maxWidth: 880,
    color: "rgba(236,229,209,.76)",
    fontSize: 33,
    lineHeight: 1.28,
  },
  commandBox: {
    display: "inline-block",
    marginTop: 22,
    border: "1px solid rgba(166,198,117,.48)",
    background: "rgba(10,12,10,.78)",
    color: "#d8f2a3",
    padding: "26px 30px",
    fontFamily: "Menlo, monospace",
    fontSize: 26,
    letterSpacing: 0,
  },
  ctaLinks: {
    marginTop: 34,
    display: "flex",
    gap: 26,
    color: "rgba(236,229,209,.72)",
    fontFamily: "Menlo, monospace",
    fontSize: 20,
  },
  ctaMarkWrap: {
    width: 430,
    height: 430,
    border: "1px solid rgba(166,198,117,.35)",
    background: "rgba(10,12,10,.62)",
    display: "grid",
    placeItems: "center",
  },
  ctaMark: {
    width: 260,
    height: 260,
    objectFit: "contain",
    opacity: 0.92,
  },
  heroGridBackground: {
    position: "absolute",
    inset: "132px 96px 92px",
    opacity: 0.72,
  },
  heroOverlayClean: {
    position: "absolute",
    left: 96,
    bottom: 112,
    maxWidth: 1060,
    padding: "42px 0 0",
  },
  generatedFrameOuter: {
    width: "100%",
    aspectRatio: "16 / 9",
    overflow: "hidden",
    border: "1px solid rgba(236,229,209,.2)",
    background: "rgba(12,14,12,.72)",
    boxShadow: "0 28px 90px rgba(0,0,0,.46)",
  },
  generatedFrame: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 650,
    overflow: "hidden",
    border: "1px solid rgba(236,229,209,.16)",
    background:
      "radial-gradient(circle at 18% 20%, rgba(166,198,117,.16), transparent 28%), linear-gradient(135deg, rgba(236,229,209,.06), rgba(236,229,209,.015))",
    transformOrigin: "center",
  },
  signalGrid: {
    position: "absolute",
    inset: 0,
  },
  signalNode: {
    position: "absolute",
    border: "1px solid rgba(236,229,209,.18)",
    background: "rgba(10,12,10,.78)",
    color: "rgba(236,229,209,.72)",
    padding: "14px 18px",
    fontFamily: "Menlo, monospace",
    fontSize: 15,
    letterSpacing: 1.2,
  },
  heroMemoryCore: {
    position: "absolute",
    right: 84,
    bottom: 70,
    display: "flex",
    alignItems: "center",
    gap: 28,
    border: "1px solid rgba(166,198,117,.34)",
    background: "rgba(10,12,10,.68)",
    padding: "30px 38px",
  },
  heroMemoryMark: {
    width: 96,
    height: 96,
    objectFit: "contain",
  },
  generatedEyebrow: {
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 13,
    letterSpacing: 3,
  },
  generatedCoreTitle: {
    color: "#ece5d1",
    fontSize: 68,
    lineHeight: 0.9,
    fontWeight: 680,
  },
  stackColumns: {
    position: "absolute",
    inset: "95px 62px",
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 22,
    zIndex: 2,
  },
  visualColumn: {
    border: "1px solid rgba(236,229,209,.18)",
    background: "rgba(12,14,12,.7)",
    padding: 24,
  },
  visualColumnFeatured: {
    border: "1px solid rgba(166,198,117,.52)",
    background: "rgba(40,52,35,.62)",
  },
  visualColumnTitle: {
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 15,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    marginBottom: 28,
  },
  visualPill: {
    border: "1px solid rgba(236,229,209,.14)",
    color: "rgba(236,229,209,.82)",
    background: "rgba(236,229,209,.035)",
    padding: "15px 16px",
    marginBottom: 14,
    fontSize: 22,
  },
  connectorLine: {
    position: "absolute",
    height: 2,
    background: "linear-gradient(90deg, transparent, rgba(166,198,117,.75), transparent)",
    zIndex: 1,
  },
  loopLayout: {
    position: "absolute",
    inset: 0,
  },
  loopCenter: {
    position: "absolute",
    left: "38%",
    top: "38%",
    width: "24%",
    height: "24%",
    border: "1px solid rgba(166,198,117,.55)",
    background: "rgba(40,52,35,.78)",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    color: "#ece5d1",
    fontFamily: "Menlo, monospace",
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 3,
  },
  loopNode: {
    position: "absolute",
    width: "22%",
    minHeight: 78,
    border: "1px solid rgba(236,229,209,.2)",
    background: "rgba(12,14,12,.76)",
    color: "rgba(236,229,209,.84)",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    fontSize: 23,
    padding: 18,
  },
  pipeline: {
    position: "absolute",
    inset: "132px 54px",
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 16,
    alignItems: "stretch",
  },
  pipelineCard: {
    border: "1px solid rgba(236,229,209,.18)",
    background: "rgba(12,14,12,.76)",
    padding: 22,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  pipelineTitle: {
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 16,
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  pipelineBody: {
    color: "rgba(236,229,209,.84)",
    fontSize: 25,
    lineHeight: 1.15,
  },
  trustLadder: {
    position: "absolute",
    inset: "74px 72px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
  },
  trustStep: {
    border: "1px solid rgba(166,198,117,.42)",
    background: "rgba(40,52,35,.66)",
    color: "#ece5d1",
    padding: "17px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 25,
  },
  recipeGrid: {
    position: "absolute",
    inset: "94px 72px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 34,
  },
  recipeCard: {
    border: "1px solid rgba(166,198,117,.42)",
    background: "rgba(12,14,12,.76)",
    padding: 34,
  },
  recipeTitle: {
    color: "#ece5d1",
    fontSize: 40,
    fontWeight: 680,
    marginBottom: 32,
  },
  recipeItem: {
    borderTop: "1px solid rgba(236,229,209,.13)",
    color: "rgba(236,229,209,.78)",
    padding: "18px 0",
    fontSize: 26,
  },
  contextGrid: {
    position: "absolute",
    inset: "82px 68px",
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 18,
  },
  contextTile: {
    border: "1px solid rgba(236,229,209,.18)",
    background: "rgba(12,14,12,.72)",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  contextTileFeatured: {
    border: "1px solid rgba(166,198,117,.48)",
    background: "rgba(40,52,35,.62)",
  },
  contextCore: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    border: "1px solid rgba(166,198,117,.7)",
    background: "rgba(10,12,10,.82)",
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 18,
    letterSpacing: 4,
    padding: "18px 26px",
  },
  fieldGrid: {
    position: "absolute",
    inset: "92px 70px 150px",
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 18,
  },
  fieldPill: {
    border: "1px solid rgba(236,229,209,.18)",
    background: "rgba(12,14,12,.76)",
    color: "rgba(236,229,209,.86)",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: 22,
    fontSize: 25,
  },
  fieldFooter: {
    position: "absolute",
    left: 70,
    right: 70,
    bottom: 76,
    borderTop: "1px solid rgba(166,198,117,.4)",
    paddingTop: 22,
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 17,
    letterSpacing: 4,
  },
  provenanceGrid: {
    position: "absolute",
    inset: "86px 70px 172px",
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 22,
  },
  provenanceCard: {
    border: "1px solid rgba(166,198,117,.4)",
    background: "rgba(12,14,12,.76)",
    padding: 30,
  },
  provenanceTitle: {
    color: "#ece5d1",
    fontSize: 38,
    fontWeight: 680,
  },
  provenanceBody: {
    marginTop: 16,
    color: "rgba(236,229,209,.68)",
    fontFamily: "Menlo, monospace",
    fontSize: 18,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  validityStrip: {
    position: "absolute",
    left: 70,
    right: 70,
    bottom: 76,
    border: "1px solid rgba(236,229,209,.18)",
    background: "rgba(40,52,35,.52)",
    color: "#ece5d1",
    padding: "20px 24px",
    fontSize: 27,
    textAlign: "center",
  },
  badGoodGrid: {
    position: "absolute",
    inset: "86px 70px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 26,
  },
  badPanel: {
    border: "1px solid rgba(197,111,96,.4)",
    background: "rgba(45,19,18,.42)",
    padding: 34,
  },
  goodPanel: {
    border: "1px solid rgba(166,198,117,.52)",
    background: "rgba(40,52,35,.62)",
    padding: 34,
  },
  badGoodKicker: {
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 16,
    letterSpacing: 3,
  },
  badGoodTitle: {
    marginTop: 42,
    color: "#ece5d1",
    fontSize: 46,
    lineHeight: 1,
    fontWeight: 680,
  },
  badGoodBody: {
    marginTop: 26,
    color: "rgba(236,229,209,.72)",
    fontSize: 27,
    lineHeight: 1.22,
  },
  brainSwapGrid: {
    position: "absolute",
    inset: "95px 78px",
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 28,
    zIndex: 2,
  },
  recipeSetGrid: {
    position: "absolute",
    inset: "78px 58px",
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 22,
  },
  announcementPage: {
    position: "relative",
    zIndex: 2,
    padding: 86,
    height: "100%",
  },
  announcementMarkWrap: {
    position: "absolute",
    right: 72,
    top: 42,
    bottom: 42,
    width: 660,
    display: "grid",
    placeItems: "center",
    opacity: 0.13,
  },
  announcementMark: {
    width: 520,
    height: 520,
    objectFit: "contain",
    transformOrigin: "center",
  },
  announcementHero: {
    marginTop: 142,
    maxWidth: 1120,
  },
  announcementTitle: {
    margin: "24px 0 24px",
    maxWidth: 1120,
    color: "#ece5d1",
    fontSize: 92,
    lineHeight: 0.94,
    letterSpacing: 0,
    fontWeight: 680,
  },
  announcementSubhead: {
    margin: 0,
    maxWidth: 930,
    color: "rgba(236,229,209,.72)",
    fontSize: 32,
    lineHeight: 1.28,
  },
  announcementCards: {
    position: "absolute",
    left: 86,
    right: 86,
    bottom: 88,
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 22,
  },
  announcementCard: {
    minHeight: 156,
    border: "1px solid rgba(166,198,117,.38)",
    background: "rgba(12,14,12,.72)",
    padding: "28px 30px",
  },
  announcementCardLabel: {
    color: "#a6c675",
    fontFamily: "Menlo, monospace",
    fontSize: 15,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    marginBottom: 22,
  },
  announcementCardValue: {
    color: "#ece5d1",
    fontSize: 36,
    lineHeight: 1.06,
    fontWeight: 650,
  },
};
