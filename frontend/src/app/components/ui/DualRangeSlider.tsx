"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface DualRangeSliderProps {
  /** Minimum value for the slider range */
  min: number;
  /** Maximum value for the slider range */
  max: number;
  /** Current minimum selected value */
  valueMin: number;
  /** Current maximum selected value */
  valueMax: number;
  /** Called when either value changes */
  onChange: (min: number, max: number) => void;
  /** Optional step increment */
  step?: number;
  /** Format value for display */
  formatValue?: (value: number) => string;
  /** Label for the slider */
  label?: string;
  /** Show value labels */
  showValues?: boolean;
  /** Optional className */
  className?: string;
  /** Unit suffix (e.g., "ms", "$") */
  unit?: string;
  /** Whether to use logarithmic scale (useful for large ranges) */
  logarithmic?: boolean;
}

export function DualRangeSlider({
  min,
  max,
  valueMin,
  valueMax,
  onChange,
  step = 1,
  formatValue,
  label,
  showValues = true,
  className = "",
  unit = "",
  logarithmic = false,
}: DualRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"min" | "max" | null>(null);

  // Handle edge cases
  const safeMin = min;
  const safeMax = Math.max(max, min + step);
  const range = safeMax - safeMin;
  
  // Ensure values are within bounds
  const clampedMin = Math.max(safeMin, Math.min(valueMin, valueMax - step));
  const clampedMax = Math.min(safeMax, Math.max(valueMax, valueMin + step));

  // Calculate percentages for positioning
  const minPercent = range > 0 ? ((clampedMin - safeMin) / range) * 100 : 0;
  const maxPercent = range > 0 ? ((clampedMax - safeMin) / range) * 100 : 100;

  const defaultFormat = useCallback(
    (value: number) => {
      if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M${unit}`;
      if (value >= 1000) return `${(value / 1000).toFixed(1)}K${unit}`;
      if (value < 1 && value > 0) return `${value.toFixed(4)}${unit}`;
      return `${Math.round(value)}${unit}`;
    },
    [unit]
  );

  const format = formatValue || defaultFormat;

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMin = Math.min(Number(e.target.value), clampedMax - step);
    onChange(newMin, clampedMax);
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMax = Math.max(Number(e.target.value), clampedMin + step);
    onChange(clampedMin, newMax);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink-400">{label}</span>
          {showValues && (
            <span className="text-xs text-ink-500">
              {format(clampedMin)} – {format(clampedMax)}
            </span>
          )}
        </div>
      )}

      <div className="relative h-6 pt-2">
        {/* Track background */}
        <div
          ref={trackRef}
          className="absolute inset-x-0 top-3 h-1.5 bg-ink-800 rounded-full"
        />

        {/* Active track */}
        <div
          className="absolute top-3 h-1.5 bg-gradient-to-r from-accent-coral to-accent-gold rounded-full"
          style={{
            left: `${minPercent}%`,
            right: `${100 - maxPercent}%`,
          }}
        />

        {/* Min thumb input */}
        <input
          type="range"
          min={safeMin}
          max={safeMax}
          step={step}
          value={clampedMin}
          onChange={handleMinChange}
          className="absolute inset-x-0 top-1 w-full h-4 appearance-none bg-transparent pointer-events-none 
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-4
                     [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-accent-coral
                     [&::-webkit-slider-thumb]:border-2
                     [&::-webkit-slider-thumb]:border-ink-950
                     [&::-webkit-slider-thumb]:cursor-grab
                     [&::-webkit-slider-thumb]:pointer-events-auto
                     [&::-webkit-slider-thumb]:shadow-md
                     [&::-webkit-slider-thumb]:transition-transform
                     [&::-webkit-slider-thumb]:hover:scale-110
                     [&::-webkit-slider-thumb]:active:cursor-grabbing
                     [&::-moz-range-thumb]:appearance-none
                     [&::-moz-range-thumb]:w-4
                     [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-accent-coral
                     [&::-moz-range-thumb]:border-2
                     [&::-moz-range-thumb]:border-ink-950
                     [&::-moz-range-thumb]:cursor-grab
                     [&::-moz-range-thumb]:pointer-events-auto"
          style={{ zIndex: clampedMin > safeMax - range / 2 ? 5 : 3 }}
        />

        {/* Max thumb input */}
        <input
          type="range"
          min={safeMin}
          max={safeMax}
          step={step}
          value={clampedMax}
          onChange={handleMaxChange}
          className="absolute inset-x-0 top-1 w-full h-4 appearance-none bg-transparent pointer-events-none
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-4
                     [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-accent-gold
                     [&::-webkit-slider-thumb]:border-2
                     [&::-webkit-slider-thumb]:border-ink-950
                     [&::-webkit-slider-thumb]:cursor-grab
                     [&::-webkit-slider-thumb]:pointer-events-auto
                     [&::-webkit-slider-thumb]:shadow-md
                     [&::-webkit-slider-thumb]:transition-transform
                     [&::-webkit-slider-thumb]:hover:scale-110
                     [&::-webkit-slider-thumb]:active:cursor-grabbing
                     [&::-moz-range-thumb]:appearance-none
                     [&::-moz-range-thumb]:w-4
                     [&::-moz-range-thumb]:h-4
                     [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-accent-gold
                     [&::-moz-range-thumb]:border-2
                     [&::-moz-range-thumb]:border-ink-950
                     [&::-moz-range-thumb]:cursor-grab
                     [&::-moz-range-thumb]:pointer-events-auto"
          style={{ zIndex: clampedMax < safeMin + range / 2 ? 5 : 4 }}
        />
      </div>

      {/* Range labels */}
      <div className="flex justify-between text-xs text-ink-600">
        <span>{format(safeMin)}</span>
        <span>{format(safeMax)}</span>
      </div>
    </div>
  );
}

