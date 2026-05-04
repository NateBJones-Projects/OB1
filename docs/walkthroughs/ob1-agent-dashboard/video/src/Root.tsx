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
  <Composition
    id="OB1AgentDashboard"
    component={OB1AgentDashboard}
    durationInFrames={durationInFrames}
    fps={fps}
    width={1920}
    height={1080}
  />
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
};
