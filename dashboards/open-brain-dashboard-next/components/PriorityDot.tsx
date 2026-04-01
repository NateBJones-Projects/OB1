"use client";

import { useState, useRef, useEffect } from "react";
import { PRIORITY_LEVELS, getPriorityLevel } from "@/lib/types";

interface PriorityDotProps {
  importance: number;
  onPriorityChange: (newImportance: number) => void;
}

export function PriorityDot({ importance, onPriorityChange }: PriorityDotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const level = getPriorityLevel(importance);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="group flex items-center gap-1.5 hover:bg-bg-hover rounded px-1 py-0.5 transition-colors"
        title={`${level.label} priority (${importance})`}
      >
        <span className={`w-2.5 h-2.5 rounded-full ${level.color}`} />
        <span className="text-xs text-text-muted group-hover:text-text-secondary hidden sm:inline">
          {level.label}
        </span>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[120px]">
          {PRIORITY_LEVELS.map((p) => {
            const isCurrentLevel = level.label === p.label;
            return (
              <button
                key={p.label}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPriorityChange(p.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg-hover transition-colors ${
                  isCurrentLevel ? "text-text-primary bg-bg-hover" : "text-text-secondary"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${p.color}`} />
                {p.label}
                {isCurrentLevel && <span className="ml-auto text-xs text-text-muted">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
