import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";

function smoothLine(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return path;
}

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

export interface AreaChartProps<T> {
  data: T[];
  getValue: (item: T) => number;
  getDate: (item: T) => Date;
  formatValue: (value: number) => string;
  tooltip?: (item: T) => ReactNode;
  color?: string;
  height?: number;
  showAxis?: boolean;
  showXLabels?: boolean;
  className?: string;
  animationKey?: string | number;
  prompt?: string;
  /** Keep 0 in view for honest absolute scale (default), or fit the data trend. */
  zeroBaseline?: boolean;
}

export function AreaChart<T>({
  data,
  getValue,
  getDate,
  formatValue,
  tooltip,
  color = "#5f7f88",
  height = 230,
  showAxis = false,
  showXLabels = true,
  className,
  animationKey = 0,
  prompt,
  zeroBaseline = true,
}: AreaChartProps<T>) {
  const rawId = useId().replaceAll(":", "");
  const gradientId = `gradient-${rawId}`;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Match the viewBox to the rendered width so axis text stays at its real size.
  const [width, setWidth] = useState(760);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const padding = {
    top: 14,
    right: showAxis ? 12 : 8,
    bottom: showXLabels ? 28 : 8,
    left: showAxis ? 52 : 8,
  };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const values = data.map(getValue);
  const dataMax = Math.max(1, ...values);
  const dataMin = Math.min(...values);
  const spread = Math.max(1, dataMax - dataMin);
  const maxValue = zeroBaseline ? niceCeil(dataMax) : dataMax + spread * 0.14;
  const minValue = zeroBaseline ? 0 : Math.max(0, dataMin - spread * 0.14);
  const points = data.map((item, index) => ({
    x: padding.left + (index / Math.max(1, data.length - 1)) * innerWidth,
    y:
      padding.top +
      innerHeight -
      ((getValue(item) - minValue) / Math.max(1, maxValue - minValue)) * innerHeight,
  }));

  const line = smoothLine(points);
  const area =
    points.length > 0
      ? `${line} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${points[0].x} ${
          padding.top + innerHeight
        } Z`
      : "";
  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const xLabelIndices =
    data.length <= 3
      ? data.map((_, index) => index)
      : [0, Math.floor((data.length - 1) / 2), data.length - 1];

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (x - padding.left) / innerWidth;
    const index = Math.round(ratio * (data.length - 1));
    setHoverIndex(Math.max(0, Math.min(data.length - 1, index)));
  };

  return (
    <div ref={wrapRef} className={cn("relative w-full select-none", className)} style={{ height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={prompt ?? "Usage over time"}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.23} />
            <stop offset="78%" stopColor={color} stopOpacity={0.035} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {showAxis &&
          ticks.map((tick) => {
            const y = padding.top + innerHeight * tick;
            return (
              <g key={tick}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-line/[0.075]"
                  strokeDasharray={tick === 1 ? undefined : "3 5"}
                />
                <text
                  x={padding.left - 10}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-current text-11 text-faint"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatValue(minValue + (maxValue - minValue) * (1 - tick))}
                </text>
              </g>
            );
          })}

        {area && (
          <motion.path
            key={`area-${animationKey}`}
            d={area}
            fill={`url(#${gradientId})`}
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12 }}
          />
        )}

        {line && (
          <motion.path
            key={`line-${animationKey}`}
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2.1}
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.12 }}
          />
        )}

        {showXLabels &&
          xLabelIndices.map((index) => {
            const point = points[index];
            if (!point) return null;
            return (
              <text
                key={index}
                x={point.x}
                y={height - 7}
                textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
                className="fill-current text-11 text-faint"
              >
                {getDate(data[index]).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </text>
            );
          })}

        {hoverPoint && (
          <g>
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={padding.top}
              y2={padding.top + innerHeight}
              stroke={color}
              strokeOpacity={0.3}
              strokeDasharray="3 4"
            />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r={5} fill="var(--panel)" />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r={3.5} fill={color} />
          </g>
        )}

        {!hoverPoint && points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={3.5}
            fill={color}
            stroke="var(--panel)"
            strokeWidth={2}
          />
        )}

        <rect
          x={padding.left}
          y={padding.top}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          className="cursor-crosshair"
        />
      </svg>

      {hovered && hoverPoint && tooltip && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none absolute z-20 min-w-[148px] rounded-[13px] border border-white/10 bg-[#211d18] px-3 py-2.5 text-paper-50 shadow-float"
          style={{
            left: `${Math.min(82, Math.max(13, (hoverPoint.x / width) * 100))}%`,
            top: Math.max(2, hoverPoint.y - 68),
            transform: "translateX(-50%)",
          }}
        >
          {tooltip(hovered)}
        </motion.div>
      )}
    </div>
  );
}

export function Sparkline({
  data,
  color = "#b8693f",
  className,
  fill = true,
  strokeWidth = 1.6,
}: {
  data: number[];
  color?: string;
  className?: string;
  fill?: boolean;
  strokeWidth?: number;
}) {
  const id = useId().replaceAll(":", "");
  const width = 160;
  const height = 48;
  const max = niceCeil(Math.max(1, ...data));
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const points = data.map((value, index) => ({
    x: (index / Math.max(1, data.length - 1)) * width,
    y: height - 4 - ((value - min) / range) * (height - 10),
  }));
  const line = smoothLine(points);
  const area = points.length
    ? `${line} L ${width} ${height} L 0 ${height} Z`
    : "";
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-12 w-full overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && area && <path d={area} fill={`url(#spark-${id})`} />}
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.12 }}
      />
    </svg>
  );
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polar(cx, cy, radius, endAngle);
  const end = polar(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function DonutChart({
  segments,
  size = 190,
  strokeWidth = 18,
  center,
  className,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  size?: number;
  strokeWidth?: number;
  center?: ReactNode;
  className?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  const radius = (size - strokeWidth * 2) / 2;
  const cx = size / 2;
  const cy = size / 2;
  let cursor = 0;
  const gap = 1.5;

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="donut-track"
        />
        {segments.map((segment, index) => {
          const share = (segment.value / total) * 360;
          const start = cursor + (index === 0 ? 0 : gap / 2);
          const end = cursor + share - gap / 2;
          cursor += share;
          if (end <= start) return null;
          return (
            <motion.path
              key={segment.label}
              d={arcPath(cx, cy, radius, start, end)}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              initial={false}
              animate={{
                pathLength: 1,
                opacity: hover && hover !== segment.label ? 0.28 : 1,
              }}
              transition={{
                pathLength: { duration: 0.12 },
                opacity: { duration: 0.18 },
              }}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(segment.label)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {hover ? (
          <>
            <span className="text-11 font-medium text-faint">{hover}</span>
            <span className="mt-0.5 text-18 font-bold tracking-[-0.03em] text-fg">
              {((segments.find((segment) => segment.label === hover)?.value ?? 0) / total * 100).toFixed(1)}%
            </span>
          </>
        ) : (
          center
        )}
      </div>
    </div>
  );
}
