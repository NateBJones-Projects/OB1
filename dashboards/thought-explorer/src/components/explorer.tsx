"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Thought, ThoughtStats } from "@/lib/types";
import { LoginForm } from "./login-form";
import { StatsHeader } from "./StatsHeader";
import { FilterBar } from "./FilterBar";
import { SearchBar } from "./SearchBar";
import { ThoughtCard } from "./ThoughtCard";
import { Heatmap } from "./Heatmap";
import { TopicClusters } from "./TopicClusters";
import { CalendarGrid } from "./CalendarGrid";
import { DayDetail } from "./DayDetail";
import { WeekView } from "./WeekView";
import { CalendarItem, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/calendar-types";

type View = "timeline" | "heatmap" | "topics" | "calendar";

export default function Explorer() {
  const clientRef = useRef(createClient());
  const client = clientRef.current;

  const [session, setSession] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("timeline");

  // Timeline state
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  // Filter state
  const [type, setType] = useState("");
  const [topic, setTopic] = useState("");
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");

  // Stats
  const [stats, setStats] = useState<ThoughtStats | null>(null);

  // Heatmap dates
  const [allDates, setAllDates] = useState<string[]>([]);

  // Topic clusters
  const [clusters, setClusters] = useState<{ topic: string; count: number }[]>([]);

  // Filter options (derived from all thoughts metadata)
  const [allTypes, setAllTypes] = useState<string[]>([]);
  const [allTopics, setAllTopics] = useState<string[]>([]);
  const [allPeople, setAllPeople] = useState<string[]>([]);

  // Calendar state
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [calItems, setCalItems] = useState<CalendarItem[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calMode, setCalMode] = useState<"month" | "week">("month");
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
  });

  // Auth check
  useEffect(() => {
    client.auth.getSession().then(({ data }) => {
      setSession(!!data.session);
    });
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, s) => {
      setSession(!!s);
    });
    return () => subscription.unsubscribe();
  }, [client]);

  // Fetch stats + filter options + heatmap dates on login
  const fetchMeta = useCallback(async () => {
    const [statsRes, datesRes] = await Promise.all([
      fetch("/api/thoughts?mode=stats"),
      fetch("/api/thoughts?mode=dates"),
    ]);
    if (statsRes.ok) {
      const { stats } = await statsRes.json();
      setStats(stats);
    }
    if (datesRes.ok) {
      const { data } = await datesRes.json();
      const dates = data.map((t: { created_at: string }) => t.created_at);
      setAllDates(dates);

      // Derive filter options and topic clusters
      const typeSet = new Set<string>();
      const topicCounts: Record<string, number> = {};
      const personSet = new Set<string>();

      for (const t of data) {
        const m = t.metadata as Record<string, unknown> | null;
        if (m?.type && typeof m.type === "string") typeSet.add(m.type);
        if (m?.topics && Array.isArray(m.topics)) {
          for (const topic of m.topics) {
            topicCounts[topic] = (topicCounts[topic] || 0) + 1;
          }
        }
        if (m?.people && Array.isArray(m.people)) {
          for (const p of m.people) personSet.add(p);
        }
      }

      setAllTypes(Array.from(typeSet).sort());
      setAllTopics(Object.keys(topicCounts).sort());
      setAllPeople(Array.from(personSet).sort());
      setClusters(
        Object.entries(topicCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([topic, count]) => ({ topic, count }))
      );
    }
  }, []);

  // Fetch timeline thoughts
  const fetchThoughts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (type) params.set("type", type);
    if (topic) params.set("topic", topic);
    if (person) params.set("person", person);
    if (search) params.set("search", search);

    const res = await fetch(`/api/thoughts?${params}`);
    if (res.ok) {
      const { data, count } = await res.json();
      setThoughts(data || []);
      setCount(count || 0);
    }
    setLoading(false);
  }, [page, type, topic, person, search]);

  // Fetch calendar items
  const fetchCalendar = useCallback(async () => {
    setCalLoading(true);
    const res = await fetch(`/api/calendar?year=${calYear}&month=${calMonth}`);
    if (res.ok) {
      const { items } = await res.json();
      setCalItems(items || []);
    }
    setCalLoading(false);
  }, [calYear, calMonth]);

  useEffect(() => {
    if (session && view === "calendar") {
      fetchCalendar();
    }
  }, [session, view, fetchCalendar]);

  useEffect(() => {
    if (session) {
      fetchMeta();
    }
  }, [session, fetchMeta]);

  useEffect(() => {
    if (session) {
      fetchThoughts();
    }
  }, [session, fetchThoughts]);

  // Reset page on filter change
  useEffect(() => {
    setPage(0);
  }, [type, topic, person, search]);

  if (session === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <LoginForm
        client={client}
        onSuccess={() => setSession(true)}
      />
    );
  }

  const totalPages = Math.ceil(count / 25);

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">
          Thought Explorer
        </h1>
        <button
          onClick={() => client.auth.signOut()}
          className="text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Stats */}
      <StatsHeader stats={stats} />

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-1">
        {(["timeline", "heatmap", "topics", "calendar"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              view === v
                ? "bg-bg-card text-accent border border-border border-b-0"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* Timeline View */}
      {view === "timeline" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <SearchBar value={search} onChange={setSearch} />
            <FilterBar
              type={type}
              topic={topic}
              person={person}
              onTypeChange={setType}
              onTopicChange={setTopic}
              onPersonChange={setPerson}
              types={allTypes}
              topics={allTopics}
              people={allPeople}
            />
          </div>

          {loading ? (
            <div className="text-sm text-text-muted py-8 text-center">
              Loading thoughts...
            </div>
          ) : thoughts.length === 0 ? (
            <div className="text-sm text-text-muted py-8 text-center">
              No thoughts found.
            </div>
          ) : (
            <div className="space-y-3">
              {thoughts.map((t) => (
                <ThoughtCard key={t.id} thought={t} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-card disabled:opacity-30"
              >
                Prev
              </button>
              <span className="text-xs text-text-muted">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-card disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Heatmap View */}
      {view === "heatmap" && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-text-secondary">
            Activity (last 6 months)
          </h2>
          <Heatmap dates={allDates} />
        </div>
      )}

      {/* Topics View */}
      {view === "topics" && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-text-secondary">
            Topic Clusters
          </h2>
          <TopicClusters
            clusters={clusters}
            activeTopic={topic}
            onSelectTopic={(t) => {
              setTopic(t);
              if (t) setView("timeline");
            }}
          />
        </div>
      )}

      {/* Calendar View */}
      {view === "calendar" && (
        <div className="space-y-4">
          {/* Calendar controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (calMode === "month") {
                    const prev = calMonth === 1 ? 12 : calMonth - 1;
                    const yr = calMonth === 1 ? calYear - 1 : calYear;
                    setCalMonth(prev);
                    setCalYear(yr);
                  } else {
                    const d = new Date(weekStart + "T12:00:00");
                    d.setDate(d.getDate() - 7);
                    setWeekStart(d.toISOString().slice(0, 10));
                  }
                  setSelectedDate(null);
                }}
                className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-card"
              >
                Prev
              </button>
              <h2 className="text-sm font-medium text-text-primary min-w-[10rem] text-center">
                {calMode === "month"
                  ? new Date(calYear, calMonth - 1).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })
                  : (() => {
                      const s = new Date(weekStart + "T12:00:00");
                      const e = new Date(s);
                      e.setDate(s.getDate() + 6);
                      return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
                    })()}
              </h2>
              <button
                onClick={() => {
                  if (calMode === "month") {
                    const next = calMonth === 12 ? 1 : calMonth + 1;
                    const yr = calMonth === 12 ? calYear + 1 : calYear;
                    setCalMonth(next);
                    setCalYear(yr);
                  } else {
                    const d = new Date(weekStart + "T12:00:00");
                    d.setDate(d.getDate() + 7);
                    setWeekStart(d.toISOString().slice(0, 10));
                  }
                  setSelectedDate(null);
                }}
                className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-card"
              >
                Next
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCalMode("month")}
                className={`px-2 py-1 text-xs rounded ${calMode === "month" ? "bg-accent text-white" : "text-text-muted hover:text-text-secondary"}`}
              >
                Month
              </button>
              <button
                onClick={() => setCalMode("week")}
                className={`px-2 py-1 text-xs rounded ${calMode === "week" ? "bg-accent text-white" : "text-text-muted hover:text-text-secondary"}`}
              >
                Week
              </button>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3">
            {Object.entries(SOURCE_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center gap-1">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: SOURCE_COLORS[key] }}
                />
                <span className="text-[10px] text-text-muted">{label}</span>
              </div>
            ))}
          </div>

          {calLoading ? (
            <div className="text-sm text-text-muted py-8 text-center">
              Loading calendar...
            </div>
          ) : calMode === "month" ? (
            <CalendarGrid
              year={calYear}
              month={calMonth}
              items={calItems}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          ) : (
            <WeekView
              startDate={weekStart}
              items={calItems}
              onSelectDate={setSelectedDate}
            />
          )}

          {/* Day detail panel */}
          {selectedDate && (
            <DayDetail
              date={selectedDate}
              items={calItems.filter((i) => i.date === selectedDate)}
              onClose={() => setSelectedDate(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
